/**
 * CDP / Playwright control path — Claude drives Brave/Chrome directly.
 * Users speak natural language; MCP tools translate. No extension WebSocket required.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

export type CdpStatus = {
  mode: "cdp";
  connected: boolean;
  cdpUrl: string;
  url?: string;
  title?: string;
  pages?: number;
};

function cdpUrl(): string {
  return (process.env.ASKJEV_CDP_URL || "http://127.0.0.1:9222").trim();
}

let browser: Browser | null = null;

export async function connectCdp(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  const url = cdpUrl();
  browser = await chromium.connectOverCDP(url, { timeout: 8_000 });
  return browser;
}

export async function disconnectCdp(): Promise<void> {
  try {
    await browser?.close();
  } catch {
    /* ignore */
  }
  browser = null;
}

async function activePage(): Promise<{ page: Page; context: BrowserContext }> {
  const b = await connectCdp();
  const contexts = b.contexts();
  const context = contexts[0] ?? (await b.newContext());
  const pages = context.pages();
  const page = pages.find((p) => !p.isClosed()) ?? (await context.newPage());
  return { page, context };
}

export async function getCdpStatus(): Promise<CdpStatus> {
  const url = cdpUrl();
  try {
    const { page } = await activePage();
    return {
      mode: "cdp",
      connected: true,
      cdpUrl: url,
      url: page.url(),
      title: await page.title().catch(() => ""),
      pages: page.context().pages().length,
    };
  } catch (e) {
    return {
      mode: "cdp",
      connected: false,
      cdpUrl: url,
    };
  }
}

/** Extract first http(s) URL from free text, or turn "example.com" into https://example.com */
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
 * Run a natural-language browser goal over CDP.
 * Phase 1: navigate when a URL/site is named; report page title.
 * Later: richer click/type loops (Jev / a11y).
 */
export async function doGoal(goal: string): Promise<DoGoalResult> {
  const steps: string[] = [];
  const { page } = await activePage();
  const nav = extractNavigateUrl(goal);

  if (nav) {
    steps.push(`navigate ${nav}`);
    await page.goto(nav, { waitUntil: "domcontentloaded", timeout: 45_000 });
  } else {
    steps.push("no URL in goal — using current tab");
  }

  // Simple keyword actions
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
    note:
      "User spoke natural language; AskJev ran it over CDP. Extension Guard still protects irreversible clicks in the browser.",
  };
}

export async function listCdpPages(): Promise<
  { url: string; title: string; active: boolean }[]
> {
  const b = await connectCdp();
  const out: { url: string; title: string; active: boolean }[] = [];
  for (const ctx of b.contexts()) {
    const pages = ctx.pages();
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      if (p.isClosed()) continue;
      out.push({
        url: p.url(),
        title: await p.title().catch(() => ""),
        active: i === pages.length - 1,
      });
    }
  }
  return out;
}
