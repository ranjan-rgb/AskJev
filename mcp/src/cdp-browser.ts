/**
 * Browser control for AskJev MCP.
 * Users never touch CDP ports or shell scripts — Claude calls askjev_do,
 * and we attach to an existing debug browser OR launch Chrome/Brave ourselves.
 */
import {
  existsSync,
  lstatSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
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

/** Max visible interactive elements collected per snapshot. */
export const SNAPSHOT_ELEMENT_LIMIT = 80;

function cdpUrl(): string {
  return (process.env.ASKJEV_CDP_URL || "http://127.0.0.1:9222").trim();
}

/** Separate profile, used when the user opts out of their own. */
export function ownProfileDir(): string {
  return join(homedir(), ".askjev", "browser-profile");
}

/**
 * The user's real browser profile — where their logins already live.
 *
 * Returns the User Data directory (the parent of Default), which is what
 * Chromium's --user-data-dir expects.
 */
export function realProfileDir(
  browserBin: string | null,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const brave = !browserBin || /brave/i.test(browserBin);
  const home = homedir();
  if (platform === "darwin") {
    return brave
      ? join(home, "Library/Application Support/BraveSoftware/Brave-Browser")
      : join(home, "Library/Application Support/Google/Chrome");
  }
  if (platform === "win32") {
    const local = env.LOCALAPPDATA;
    if (!local) return null;
    return brave
      ? join(local, "BraveSoftware", "Brave-Browser", "User Data")
      : join(local, "Google", "Chrome", "User Data");
  }
  return brave
    ? join(home, ".config", "BraveSoftware", "Brave-Browser")
    : join(home, ".config", "google-chrome");
}

/**
 * True while the browser owning this profile is running. Chromium keeps a
 * SingletonLock symlink there; a second process cannot use the directory, and
 * forcing it risks corrupting their history and cookies.
 */
export function isProfileLocked(dir: string): boolean {
  try {
    return lstatSync(join(dir, "SingletonLock")).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Opt out of the user's own profile with ASKJEV_OWN_PROFILE=1. */
function wantsSeparateProfile(env: NodeJS.ProcessEnv = process.env): boolean {
  return ["1", "true", "yes"].includes(
    String(env.ASKJEV_OWN_PROFILE || "").trim().toLowerCase(),
  );
}

export type ProfileChoice = {
  dir: string;
  /** True when this is the user's real profile with their existing logins. */
  isReal: boolean;
};

/**
 * Pick the profile to drive.
 *
 * Default is the user's OWN browser profile, because the whole point is that
 * "open x.com and check my mentions" should find them logged in. A throwaway
 * profile silently lands on a sign-in wall instead, which reads as AskJev being
 * broken.
 *
 * If their browser is running it holds the profile lock, and we refuse rather
 * than quietly switching to an empty profile — being logged out for no stated
 * reason is exactly the confusing failure this is meant to remove.
 */
export function chooseProfile(
  browserBin: string | null,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): ProfileChoice {
  const custom = (env.ASKJEV_PROFILE_DIR || "").trim();
  if (custom) return { dir: custom, isReal: false };
  if (wantsSeparateProfile(env)) return { dir: ownProfileDir(), isReal: false };

  const real = realProfileDir(browserBin, platform, env);
  if (real && existsSync(real)) {
    if (isProfileLocked(real)) {
      throw new Error(
        "AskJev wants to use your own browser profile so you stay signed in, " +
          "but your browser is open and holding it. Quit Brave/Chrome completely " +
          "(Cmd+Q), then ask again — AskJev will reopen it for you. " +
          "To use a separate signed-out profile instead, set ASKJEV_OWN_PROFILE=1.",
      );
    }
    return { dir: real, isReal: true };
  }
  return { dir: ownProfileDir(), isReal: false };
}

/** Debug port to launch on, so other AskJev processes can attach to us. */
export function cdpPort(url = cdpUrl()): number {
  try {
    const p = Number(new URL(url).port);
    return Number.isInteger(p) && p > 0 ? p : 9222;
  } catch {
    return 9222;
  }
}

/**
 * Claude Desktop starts one askjev-mcp per session pool (Chat, Cowork, Code),
 * so several processes race to open a browser for the same user. Each has its
 * own module state and cannot see the others, and the loser of the race used to
 * launch a SECOND browser — which is why one "open google.com" opened the page
 * twice.
 *
 * The lock makes exactly one process launch; the rest wait and attach to it
 * over CDP. It is advisory and self-healing: a stale lock from a crashed
 * process is ignored once it ages out.
 */
const LAUNCH_LOCK_TTL_MS = 30_000;

function launchLockPath(port: number): string {
  return join(tmpdir(), `askjev-launch-${port}.lock`);
}

/** Take the launch lock, or report that someone else holds a fresh one. */
function acquireLaunchLock(port: number): boolean {
  const p = launchLockPath(port);
  try {
    writeFileSync(p, String(process.pid), { flag: "wx" });
    return true;
  } catch {
    try {
      const age = Date.now() - statSync(p).mtimeMs;
      if (age > LAUNCH_LOCK_TTL_MS) {
        // Previous holder died mid-launch — reclaim it.
        writeFileSync(p, String(process.pid));
        return true;
      }
    } catch {
      /* vanished between calls — let the caller retry the connect */
    }
    return false;
  }
}

function releaseLaunchLock(port: number): void {
  try {
    rmSync(launchLockPath(port), { force: true });
  } catch {
    /* best effort */
  }
}

async function tryConnect(timeoutMs = 1_500): Promise<Browser | null> {
  try {
    return await chromium.connectOverCDP(cdpUrl(), { timeout: timeoutMs });
  } catch {
    return null;
  }
}

let browser: Browser | null = null;
let launchedByMcp = false;
let ownContext: BrowserContext | null = null;

/** System Chrome / Brave / Chromium — no playwright install / no user script. */
export function findSystemBrowser(): string | null {
  const fromEnv = (process.env.ASKJEV_BROWSER_BIN || "").trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  for (const p of browserCandidates()) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Candidate browser binaries, Brave first on every platform.
 * Exported so tests can assert the paths are real strings, not escaped literals.
 */
export function browserCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (platform === "darwin") {
    return [
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
  }
  if (platform === "win32") {
    const programFiles = env.PROGRAMFILES || "C:\\Program Files";
    const programFilesX86 =
      env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const localAppData = env.LOCALAPPDATA || "";
    const out = [
      `${programFiles}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
      `${programFilesX86}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
      `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ];
    if (localAppData) {
      // Per-user installs, which is the default for Chrome on Windows.
      out.push(
        `${localAppData}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
        `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`,
      );
    }
    return out;
  }
  return [
    "/usr/bin/brave-browser",
    "/usr/bin/brave-browser-stable",
    "/snap/bin/brave",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
}

export async function ensureBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;

  // Already-running debug browser — ours from an earlier launch, another
  // askjev-mcp process, or a power user's. Silent.
  const attached = await tryConnect();
  if (attached) {
    browser = attached;
    launchedByMcp = false;
    ownContext = null;
    return browser;
  }

  const executablePath = findSystemBrowser();
  if (!executablePath) {
    throw new Error(
      "AskJev could not find Chrome or Brave on this computer. Install Google Chrome, then ask Claude again in plain language.",
    );
  }

  const port = cdpPort();
  if (!acquireLaunchLock(port)) {
    // Another process is mid-launch. Wait for its browser instead of opening
    // a second one on top of the user's screen.
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const shared = await tryConnect(1_000);
      if (shared) {
        browser = shared;
        launchedByMcp = false;
        ownContext = null;
        return browser;
      }
    }
    // The other process never came up — fall through and launch ourselves.
  }

  try {
    // Persistent profile, not the throwaway one chromium.launch() would pick.
    // A temp profile means every run starts logged out of everything, so a goal
    // like "open x.com and check my mentions" lands on a sign-in wall even
    // though the user is logged in elsewhere. With a durable directory they log
    // in once per site and it sticks.
    //
    // Prefer the user's OWN profile so their existing logins are there.
    const profile = chooseProfile(executablePath);
    ownContext = await chromium.launchPersistentContext(profile.dir, {
      headless: false,
      executablePath,
      viewport: null,
      args: [
        // Expose the port so sibling askjev-mcp processes attach here rather
        // than launching their own window.
        `--remote-debugging-port=${port}`,
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });
    launchedByMcp = true;
    // A persistent context restores its previous tabs; only open one if empty.
    if (ownContext.pages().length === 0) await ownContext.newPage();
    // browser() is null for persistent contexts in Playwright, so callers that
    // need a Browser attach over the port we just opened.
    browser = ownContext.browser() ?? (await tryConnect(5_000));
    if (!browser) {
      throw new Error(
        "AskJev opened a browser but could not control it. Retry, or set ASKJEV_CDP_URL to a free port.",
      );
    }
    return browser;
  } finally {
    releaseLaunchLock(port);
  }
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

/**
 * The tab the user is actually looking at.
 *
 * Playwright exposes no "active tab" over CDP, so ask each page whether it is
 * the visible one. Picking pages[0] drove whichever tab happened to be leftmost,
 * which is rarely the tab the user just asked about.
 */
async function pickVisiblePage(pages: Page[]): Promise<Page | null> {
  const open = pages.filter((p) => !p.isClosed());
  if (open.length === 0) return null;
  if (open.length === 1) return open[0];

  const flags = await Promise.all(
    open.map(async (p) => {
      try {
        return Boolean(
          await p.evaluate(`document.visibilityState === "visible"`),
        );
      } catch {
        return false;
      }
    }),
  );
  const visibleIndex = flags.lastIndexOf(true);
  // No page reports visible (all backgrounded) — the newest tab is the best guess.
  return visibleIndex >= 0 ? open[visibleIndex] : open[open.length - 1];
}

async function activePage(): Promise<{ page: Page; context: BrowserContext }> {
  const b = await ensureBrowser();
  if (launchedByMcp && ownContext) {
    const page =
      (await pickVisiblePage(ownContext.pages())) ??
      (await ownContext.newPage());
    return { page, context: ownContext };
  }
  const contexts = b.contexts();
  const context = contexts[0] ?? (await b.newContext());
  const page =
    (await pickVisiblePage(context.pages())) ?? (await context.newPage());
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
  const { context, page: current } = await activePage();
  const out: { url: string; title: string; active: boolean }[] = [];
  for (const p of context.pages()) {
    if (p.isClosed()) continue;
    out.push({
      url: p.url(),
      title: await p.title().catch(() => ""),
      // Same resolution AskJev acts on, so the report never contradicts reality.
      active: p === current,
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
    // Ids from an earlier snapshot must not survive: a re-render can leave a
    // stale data-askjev-id on a different node, and locator().first() would
    // then act on whichever copy comes first in DOM order.
    for (const old of document.querySelectorAll("[data-askjev-id]")) {
      old.removeAttribute("data-askjev-id");
    }
    const out = [];
    const nodes = Array.from(
      document.querySelectorAll(
        "a, button, input, textarea, select, [role='button'], [role='link'], [contenteditable='true']",
      ),
    );
    let id = 1;
    for (const el of nodes) {
      // Cap AFTER the visibility test — capping the raw query first meant a page
      // whose first ${SNAPSHOT_ELEMENT_LIMIT} matches were hidden returned nothing at all.
      if (out.length >= ${SNAPSHOT_ELEMENT_LIMIT}) break;
      const html = el;
      if (!(html.offsetWidth || html.offsetHeight || html.getClientRects().length)) continue;
      if (html.getAttribute("aria-hidden") === "true") continue;
      if (html.disabled === true) continue;
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
    ...elements.map(
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
