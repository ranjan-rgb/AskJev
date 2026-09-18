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

/**
 * Multi-step TypeSafe Jev Autopilot (System One). Requires ASKJEV_API_KEY /
 * TYPESAFE_API_KEY — does not silently navigate+scroll without Jev.
 */
export async function doGoal(
  goal: string,
  typeText?: string,
): Promise<DoGoalResult> {
  // Lazy import avoids circular init with jev-autopilot → cdp-browser helpers
  const { runJevAutopilot } = await import("./jev-autopilot.js");
  const steps: string[] = [];
  if (launchedByMcp) steps.push("opened Chrome/Brave for you");
  const result = await runJevAutopilot({ goal, typeText });
  return {
    ...result,
    steps: [...steps, ...result.steps],
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

export type SnapshotElement = {
  id: number;
  tag: string;
  role: string;
  name: string;
  type?: string;
  href?: string;
  value?: string;
};

export async function navigate(url: string): Promise<{ url: string; title: string }> {
  const { page } = await activePage();
  let target = url.trim();
  if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 });
  return { url: page.url(), title: await page.title().catch(() => "") };
}

export async function snapshot(goal?: string): Promise<{
  url: string;
  title: string;
  goal?: string;
  elements: SnapshotElement[];
  state: string;
}> {
  const { page } = await activePage();
  const elements = (await page.evaluate(`(() => {
    const out = [];
    const nodes = Array.from(
      document.querySelectorAll(
        "a, button, input, textarea, select, [role='button'], [role='link'], [contenteditable='true']",
      ),
    ).slice(0, 80);
    let id = 1;
    for (const el of nodes) {
      const html = el;
      if (!(html.offsetWidth || html.offsetHeight || html.getClientRects().length)) continue;
      const tag = html.tagName.toLowerCase();
      const role =
        html.getAttribute("role") ||
        (tag === "a" ? "link" : tag === "button" ? "button" : tag);
      const name = (
        html.innerText ||
        html.getAttribute("aria-label") ||
        html.getAttribute("placeholder") ||
        html.getAttribute("name") ||
        html.getAttribute("title") ||
        ""
      )
        .trim()
        .slice(0, 120);
      const item = { id: id++, tag, role, name };
      if (tag === "input") item.type = html.type || "text";
      if (tag === "a") item.href = html.href;
      if ("value" in html) item.value = String(html.value || "").slice(0, 80);
      out.push(item);
      html.setAttribute("data-askjev-id", String(item.id));
    }
    return out;
  })()`)) as SnapshotElement[];
  const title = await page.title().catch(() => "");
  const url = page.url();
  const state = [
    `url=${url}`,
    `title=${title}`,
    goal ? `goal=${goal}` : "",
    `elements=${elements.length}`,
    ...elements.slice(0, 40).map(
      (e) => `#${e.id} ${e.role} "${e.name}"${e.href ? ` ${e.href}` : ""}`,
    ),
  ]
    .filter(Boolean)
    .join("\n");
  return { url, title, goal, elements, state };
}

export type ActAction =
  | "CLICK"
  | "TYPE_TEXT"
  | "SELECT"
  | "SCROLL_DOWN"
  | "SCROLL_UP"
  | "WAIT"
  | "PRESS";

export async function act(opts: {
  action: ActAction;
  targetId?: number;
  text?: string;
  key?: string;
}): Promise<{ ok: true; detail: string; url: string; title: string }> {
  const { page } = await activePage();
  const { action, targetId, text, key } = opts;
  let detail = String(action);

  if (action === "SCROLL_DOWN") {
    await page.mouse.wheel(0, 900);
    detail = "scrolled down";
  } else if (action === "SCROLL_UP") {
    await page.mouse.wheel(0, -900);
    detail = "scrolled up";
  } else if (action === "WAIT") {
    await new Promise((r) => setTimeout(r, 1000));
    detail = "waited 1s";
  } else if (action === "PRESS") {
    await page.keyboard.press((key || text || "Enter") as "Enter");
    detail = `pressed ${key || text || "Enter"}`;
  } else if (action === "CLICK" || action === "TYPE_TEXT" || action === "SELECT") {
    if (targetId == null) throw new Error("targetId required for " + action);
    const sel = `[data-askjev-id="${targetId}"]`;
    const loc = page.locator(sel).first();
    if (action === "CLICK") {
      await loc.click({ timeout: 10_000 });
      detail = `clicked #${targetId}`;
    } else if (action === "TYPE_TEXT") {
      await loc.click({ timeout: 10_000 });
      await loc.fill(text || "", { timeout: 10_000 });
      detail = `typed into #${targetId}`;
    } else {
      await loc.selectOption(text || "", { timeout: 10_000 }).catch(async () => {
        await loc.fill(text || "");
      });
      detail = `selected on #${targetId}`;
    }
  } else {
    throw new Error("unknown action " + action);
  }

  return {
    ok: true,
    detail,
    url: page.url(),
    title: await page.title().catch(() => ""),
  };
}

export async function clickText(text: string): Promise<{ detail: string }> {
  const { page } = await activePage();
  const t = text.trim();
  await page.getByRole("button", { name: t }).first().click({ timeout: 8_000 }).catch(async () => {
    await page.getByRole("link", { name: t }).first().click({ timeout: 8_000 }).catch(async () => {
      await page.getByText(t, { exact: false }).first().click({ timeout: 8_000 });
    });
  });
  return { detail: `clicked text "${t}"` };
}

export async function typeIntoFocused(text: string): Promise<{ detail: string }> {
  const { page } = await activePage();
  await page.keyboard.type(text, { delay: 20 });
  return { detail: `typed ${text.length} chars` };
}

export async function goBack(): Promise<{ url: string }> {
  const { page } = await activePage();
  await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => undefined);
  return { url: page.url() };
}

export async function goForward(): Promise<{ url: string }> {
  const { page } = await activePage();
  await page.goForward({ waitUntil: "domcontentloaded" }).catch(() => undefined);
  return { url: page.url() };
}

export async function pageContent(): Promise<{
  url: string;
  title: string;
  text: string;
}> {
  const { page } = await activePage();
  const text = String(
    await page.evaluate(`document.body && document.body.innerText ? document.body.innerText.slice(0, 12000) : ""`),
  );
  return {
    url: page.url(),
    title: await page.title().catch(() => ""),
    text,
  };
}

export async function screenshotPng(): Promise<Buffer> {
  const { page } = await activePage();
  return await page.screenshot({ type: "png", fullPage: false });
}
