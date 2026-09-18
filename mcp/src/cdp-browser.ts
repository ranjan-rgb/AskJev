/**
 * Browser control for AskJev MCP.
 * Users never touch CDP ports or shell scripts — Claude calls askjev_do,
 * and we attach to an existing debug browser OR launch Chrome/Brave ourselves.
 */
import { existsSync } from "node:fs";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright-core";

export type CdpStatus = {
  mode: "cdp" | "launch";
  connected: boolean;
  cdpUrl: string;
  launchedByMcp: boolean;
  url?: string;
  title?: string;
  pages?: number;
  browser?: string;
};

function cdpUrl(): string {
  return (process.env.ASKJEV_CDP_URL || "http://127.0.0.1:9222").trim();
}

let browser: Browser | null = null;
let launchedByMcp = false;
let ownContext: BrowserContext | null = null;

/** System Chrome / Brave / Chromium — no playwright install / no user script. */
export function findSystemBrowser(): string | null {
  const fromEnv = (process.env.ASKJEV_BROWSER_BIN || "").trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ]
      : process.platform === "win32"
        ? [
            "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe",
            "C:\\\\Program Files\\\\BraveSoftware\\\\Brave-Browser\\\\Application\\\\brave.exe",
            "C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe",
          ]
        : [
            "/usr/bin/google-chrome-stable",
            "/usr/bin/google-chrome",
            "/usr/bin/brave-browser",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
          ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export async function ensureBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;

  // Optional: already-running debug browser (power users / our launcher). Silent.
  try {
    browser = await chromium.connectOverCDP(cdpUrl(), { timeout: 1_500 });
    launchedByMcp = false;
    return browser;
  } catch {
    /* launch ourselves */
  }

  const executablePath = findSystemBrowser();
  if (!executablePath) {
    throw new Error(
      "AskJev could not find Chrome or Brave on this computer. Install Google Chrome, then ask Claude again in plain language.",
    );
  }

  browser = await chromium.launch({
    headless: false,
    executablePath,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  launchedByMcp = true;
  ownContext = await browser.newContext();
  await ownContext.newPage();
  return browser;
}

/** @deprecated use ensureBrowser — kept name for callers */
export async function connectCdp(): Promise<Browser> {
  return ensureBrowser();
}

export async function disconnectCdp(): Promise<void> {
  try {
    if (launchedByMcp) await browser?.close();
  } catch {
    /* ignore */
  }
  browser = null;
  ownContext = null;
  launchedByMcp = false;
}

async function activePage(): Promise<{ page: Page; context: BrowserContext }> {
  const b = await ensureBrowser();
  if (launchedByMcp && ownContext) {
    const pages = ownContext.pages().filter((p) => !p.isClosed());
    const page = pages[0] ?? (await ownContext.newPage());
    return { page, context: ownContext };
  }
  const contexts = b.contexts();
  const context = contexts[0] ?? (await b.newContext());
  const pages = context.pages().filter((p) => !p.isClosed());
  const page = pages[0] ?? (await context.newPage());
  return { page, context };
}

export async function getCdpStatus(): Promise<CdpStatus> {
  const url = cdpUrl();
  try {
    const { page } = await activePage();
    return {
      mode: launchedByMcp ? "launch" : "cdp",
      connected: true,
      cdpUrl: url,
      launchedByMcp,
      url: page.url(),
      title: await page.title().catch(() => ""),
      pages: page.context().pages().length,
      browser: findSystemBrowser() || undefined,
    };
  } catch {
    return {
      mode: "launch",
      connected: false,
      cdpUrl: url,
      launchedByMcp: false,
      browser: findSystemBrowser() || undefined,
    };
  }
}

export function extractNavigateUrl(goal: string): string | null {
  const raw = goal.trim();
  const abs = raw.match(/https?:\/\/[^\s"'<>]+/i);
  if (abs) return abs[0].replace(/[.,);]+$/, "");
  const domain = raw.match(
    /\b((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/[^\s]*)?/i,
  );
  if (domain) {
    const d = domain[0].replace(/[.,);]+$/, "");
    if (!/^(ok|and|the|for|with|from|this|that)$/i.test(d)) {
      return `https://${d}`;
    }
  }
  const go = raw.match(
    /(?:go to|open|visit|navigate to|load)\s+([^\s]+)/i,
  );
  if (go) {
    const t = go[1].replace(/[.,);]+$/, "");
    if (/^https?:\/\//i.test(t)) return t;
    if (t.includes(".")) return `https://${t}`;
  }
  return null;
}

export type DoGoalResult = {
  ok: boolean;
  goal: string;
  steps: string[];
  url?: string;
  title?: string;
  note?: string;
};

export async function doGoal(goal: string): Promise<DoGoalResult> {
  const steps: string[] = [];
  const { page } = await activePage();
  if (launchedByMcp) steps.push("opened Chrome/Brave for you");
  const nav = extractNavigateUrl(goal);

  if (nav) {
    steps.push(`navigate ${nav}`);
    await page.goto(nav, { waitUntil: "domcontentloaded", timeout: 45_000 });
  } else {
    steps.push("no URL in goal — using current tab");
  }

  const lower = goal.toLowerCase();
  if (/\bscroll down\b/.test(lower)) {
    await page.mouse.wheel(0, 800);
    steps.push("scroll down");
  }
  if (/\bscroll up\b/.test(lower)) {
    await page.mouse.wheel(0, -800);
    steps.push("scroll up");
  }

  const title = await page.title().catch(() => "");
  const url = page.url();
  steps.push(`page title: ${title || "(none)"}`);

  return {
    ok: true,
    goal,
    steps,
    url,
    title,
    note: "User spoke naturally. AskJev drove the browser — no scripts or ports for the user.",
  };
}

export async function listCdpPages(): Promise<
  { url: string; title: string; active: boolean }[]
> {
  await ensureBrowser();
  const { context } = await activePage();
  const out: { url: string; title: string; active: boolean }[] = [];
  const pages = context.pages();
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (p.isClosed()) continue;
    out.push({
      url: p.url(),
      title: await p.title().catch(() => ""),
      active: i === pages.length - 1,
    });
  }
  return out;
}
