import { BASE_KEYWORDS, BUTTON_ONLY_KEYWORDS, DESTRUCTIVE_CLASS_RE } from "./defaults.js";
import type { SystemOneResult } from "./jev.js";
import {
  clearAskjevIds,
  executeAction,
  formatSnapshotForJev,
  snapshotElements,
  type DomAction,
} from "./dom.js";
import {
  GUARD_JEV_TIMEOUT_MS,
  applyGuardDismiss,
  guardJevTimeoutMessage,
  isPassThroughActive,
  passThroughUntilFrom,
  resolveGuardVerdict,
} from "./guard-policy.js";

type SettingsCache = {
  enabled: boolean;
  customKeywords: string[];
  allowlist: string[];
  hasKey: boolean;
  sensitivity?: string;
  gateFormSubmits?: boolean;
  requireConfirmOnAsk?: boolean;
  showOverlayOnProceed?: boolean;
};

declare global {
  interface Window {
    __askjevLoaded?: boolean;
  }
}

if (!window.__askjevLoaded) {
  window.__askjevLoaded = true;

  let settingsCache: SettingsCache = {
    enabled: true,
    customKeywords: [],
    allowlist: [],
    hasKey: false,
  };
  let busy = false;
  let overlayHost: HTMLDivElement | null = null;
  let passThroughUntil = 0;

  function refreshSettings(): void {
    try {
      chrome.runtime.sendMessage({ type: "askjev.getSettings" }, (resp) => {
        if (chrome.runtime.lastError || !resp?.ok) return;
        settingsCache = { ...settingsCache, ...resp.settings };
      });
    } catch {
      /* ignore */
    }
  }
  refreshSettings();
  setInterval(refreshSettings, 5000);

  function hostAllowed(hostname: string): boolean {
    return (settingsCache.allowlist || []).some(
      (d) => hostname === d || hostname.endsWith(`.${d}`),
    );
  }

  function riskRegex(): RegExp {
    const extra = (settingsCache.customKeywords || [])
      .map((k) => String(k).trim())
      .filter(Boolean);
    const all = [...BASE_KEYWORDS, ...extra].map((k) =>
      k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    return new RegExp(`\\b(${all.join("|")})\\b`, "i");
  }

  function labelFor(el: Element): string {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim().slice(0, 160);
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, 160);
    if (el instanceof HTMLInputElement) {
      return (el.value || el.name || el.type || "").slice(0, 160);
    }
    return el.tagName;
  }

  function clickableFrom(el: Element): Element {
    return (
      el.closest(
        "button, a, [role='button'], input[type='submit'], input[type='button']",
      ) || el
    );
  }

  function isRiskTarget(el: Element): boolean {
    const clickable = clickableFrom(el);
    const label = labelFor(clickable);
    const href =
      clickable instanceof HTMLAnchorElement ? clickable.href || "" : "";
    const re = riskRegex();
    const isPlainNavLink =
      clickable instanceof HTMLAnchorElement &&
      clickable.getAttribute("role") !== "button" &&
      !clickable.closest("form");

    // Never gate plain in-page / site navigation links on weak words.
    if (isPlainNavLink) {
      const strong = /\b(delete|pay|checkout|purchase|withdraw|deploy|revoke|wipe|terminate|close account)\b/i;
      return strong.test(label) || strong.test(href);
    }

    if (re.test(label) || re.test(href)) return true;

    const className =
      typeof (clickable as HTMLElement).className === "string"
        ? (clickable as HTMLElement).className
        : "";
    if (DESTRUCTIVE_CLASS_RE.test(className)) return true;

    const isButtonLike =
      clickable instanceof HTMLButtonElement ||
      clickable.getAttribute("role") === "button" ||
      (clickable instanceof HTMLInputElement &&
        (clickable.type === "submit" || clickable.type === "button"));
    if (isButtonLike) {
      const btnRe = new RegExp(
        "\\b(" +
          [...BUTTON_ONLY_KEYWORDS]
            .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("|") +
          ")\\b",
        "i",
      );
      if (btnRe.test(label)) return true;
    }

    const isSubmit =
      (clickable instanceof HTMLInputElement &&
        (clickable.type === "submit" || clickable.type === "button")) ||
      (clickable instanceof HTMLButtonElement &&
        (clickable.type === "submit" || clickable.type === "button"));
    const inForm = Boolean(clickable.closest("form"));
    const paranoid =
      settingsCache.sensitivity === "paranoid" ||
      settingsCache.gateFormSubmits === true;
    if (paranoid && isSubmit && inForm) return true;

    const generic = /^(ok|yes|continue|next|done|save|apply|go)$/i.test(label.trim());
    if (isSubmit && inForm && generic) return true;

    return false;
  }


  function pageSnippet() {
    return {
      title: document.title || "",
      url: location.href,
      h1: document.querySelector("h1")?.textContent?.slice(0, 160) || "",
      body: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 1400),
    };
  }

  function hideOverlay(): void {
    overlayHost?.remove();
    overlayHost = null;
  }

  function escapeHtml(s: string): string {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmt(n: number | undefined, d: number): string {
    if (n == null || Number.isNaN(Number(n))) return "—";
    return Number(n).toFixed(d);
  }

  function showOverlay(opts: {
    label: string;
    decision: SystemOneResult["answers"] | null;
    error?: string;
    statusText?: string;
    onAllow: () => void;
    onBlock: () => void;
  }): void {
    hideOverlay();
    overlayHost = document.createElement("div");
    overlayHost.id = "askjev-root";
    const shadow = overlayHost.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        .wrap{position:fixed;inset:0;z-index:2147483647;background:rgba(9,9,11,.78);display:flex;align-items:center;justify-content:center;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}
        .card{width:min(440px,92vw);background:#09090b;color:#fafafa;border:1px solid #27272a;border-radius:16px;padding:20px;box-shadow:0 24px 80px rgba(0,0,0,.55)}
        .brand{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#a1a1aa;margin:0 0 8px}
        h1{font-size:17px;margin:0 0 6px;font-weight:650}
        .muted{color:#a1a1aa;font-size:12px;margin:0 0 14px;line-height:1.45}
        .row{display:flex;justify-content:space-between;gap:12px;font-size:13px;margin:7px 0;padding:8px 10px;background:#18181b;border-radius:10px}
        .val{font-variant-numeric:tabular-nums;color:#fafafa;font-weight:600}
        .btns{display:flex;gap:8px;margin-top:16px}
        button{flex:1;border:0;border-radius:10px;padding:11px;font-weight:650;cursor:pointer;font-size:13px}
        .allow{background:#fafafa;color:#09090b}
        .block{background:#27272a;color:#fafafa}
        .err{color:#fb7185;font-size:12px;margin-top:10px;line-height:1.4}
        .pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#27272a;font-size:11px;margin-left:6px}
      </style>
      <div class="wrap"><div class="card">
        <p class="brand">AskJev · TypeSafe Jev</p>
        <h1>Ask Jev before this click</h1>
        <p class="muted">“${escapeHtml(opts.label)}” ${opts.statusText ? `<span class="pill">${escapeHtml(opts.statusText)}</span>` : ""}</p>
        <div id="stats"></div>
        <div class="btns" id="btns"></div>
        <div class="err" id="err"></div>
      </div></div>
    `;
    const stats = shadow.getElementById("stats")!;
    const err = shadow.getElementById("err")!;
    const btns = shadow.getElementById("btns")!;
    err.textContent = opts.error || "";
    if (opts.decision) {
      const irr = opts.decision.irreversible?.noul;
      const risk = opts.decision.risk?.score;
      const action = opts.decision.action?.choice;
      const conf = opts.decision.action?.confidence;
      stats.innerHTML = `
        <div class="row"><span>irreversible</span><span class="val">${fmt(irr, 3)}</span></div>
        <div class="row"><span>risk</span><span class="val">${fmt(risk, 2)}</span></div>
        <div class="row"><span>jev</span><span class="val">${action || "—"} ${conf != null ? `(${fmt(conf, 2)})` : ""}</span></div>
      `;
    } else if (!opts.error) {
      stats.innerHTML = `<div class="muted">asking jev…</div>`;
    }
    const allow = document.createElement("button");
    allow.className = "allow";
    allow.textContent = "Allow once";
    allow.onclick = () => {
      hideOverlay();
      opts.onAllow();
    };
    const block = document.createElement("button");
    block.className = "block";
    block.textContent = "Keep blocked";
    block.onclick = () => {
      hideOverlay();
      opts.onBlock();
    };
    const dismiss = document.createElement("button");
    dismiss.className = "block";
    dismiss.textContent = "Dismiss — keep browsing";
    dismiss.onclick = () => {
      hideOverlay();
      const d = applyGuardDismiss({});
      busy = d.busy;
      passThroughUntil = d.passThroughUntil;
    };
    btns.append(allow, block, dismiss);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        hideOverlay();
        const d = applyGuardDismiss({});
        busy = d.busy;
        passThroughUntil = d.passThroughUntil;
        window.removeEventListener("keydown", onKey, true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    document.documentElement.appendChild(overlayHost);
  }

  function decide(label: string): Promise<{
    ok?: boolean;
    bypass?: boolean;
    error?: string;
    result?: SystemOneResult;
    settings?: { showOverlayOnProceed?: boolean; requireConfirmOnAsk?: boolean };
  }> {
    const sn = pageSnippet();
    const state = [
      `url: ${sn.url}`,
      `title: ${sn.title}`,
      `h1: ${sn.h1}`,
      `button_label: ${label}`,
      `page_text: ${sn.body}`,
    ].join("\n");
    return new Promise((resolve) => {
      let settled = false;
      const done = (v: {
        ok?: boolean;
        bypass?: boolean;
        error?: string;
        result?: SystemOneResult;
        settings?: { showOverlayOnProceed?: boolean; requireConfirmOnAsk?: boolean };
      }) => {
        if (settled) return;
        settled = true;
        resolve(v);
      };
      const timer = window.setTimeout(() => {
        done({ ok: false, error: guardJevTimeoutMessage() });
      }, GUARD_JEV_TIMEOUT_MS);
      try {
        chrome.runtime.sendMessage({ type: "askjev.decide", state }, (resp) => {
          window.clearTimeout(timer);
          if (chrome.runtime.lastError) {
            done({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          done(resp ?? { ok: false, error: "no_response" });
        });
      } catch (e) {
        window.clearTimeout(timer);
        done({ ok: false, error: String((e as Error)?.message ?? e) });
      }
    });
  }

  function fireClick(el: Element): void {
    passThroughUntil = passThroughUntilFrom("allow");
    busy = true;
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, view: window }),
    );
    setTimeout(() => {
      busy = false;
    }, 400);
  }

  function stat(key: string): void {
    try {
      chrome.runtime.sendMessage({ type: "askjev.stat", key });
    } catch {
      /* ignore */
    }
  }

  document.addEventListener(
    "click",
    (ev) => {
      void (async () => {
        if (isPassThroughActive(passThroughUntil)) return;
        if (busy) return;
        if (!settingsCache.enabled) return;
        if (hostAllowed(location.hostname)) return;
        if (!settingsCache.hasKey) return; // don't freeze the web until a key is set
        const t = ev.target;
        if (!(t instanceof Element)) return;
        if (!isRiskTarget(t)) return;

        const clickable = clickableFrom(t);
        const label = labelFor(clickable) || "unknown";

        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();

        busy = true;
        showOverlay({
          label,
          decision: null,
          statusText: "checking",
          onAllow: () => {},
          onBlock: () => {},
        });

        const resp = await decide(label);
        busy = false;

        if (resp?.bypass) {
          hideOverlay();
          fireClick(clickable);
          return;
        }

        if (!resp?.ok) {
          const err =
            resp?.error === "missing_api_key"
              ? "Add your TypeSafe API key in AskJev options."
              : `Jev error: ${resp?.error || "unknown"}`;
          showOverlay({
            label,
            decision: null,
            error: err,
            statusText: "error",
            onAllow: () => fireClick(clickable),
            onBlock: () => {},
          });
          return;
        }

        const decision = resp.result?.answers ?? null;
        const choice = decision?.action?.choice;

        const wantConfirm =
          resp.settings?.requireConfirmOnAsk === true ||
          settingsCache.requireConfirmOnAsk === true;
        const verdict = resolveGuardVerdict({
          choice,
          irreversible: decision?.irreversible?.noul,
          confidence: decision?.action?.confidence,
          requireConfirmOnAsk: wantConfirm,
        });

        if (verdict.outcome === "allow") {
          stat("proceeded");
          if (
            verdict.reason === "confident_proceed" &&
            resp.settings?.showOverlayOnProceed
          ) {
            showOverlay({
              label,
              decision,
              statusText: "proceed",
              onAllow: () => fireClick(clickable),
              onBlock: () => {},
            });
          } else {
            hideOverlay();
            fireClick(clickable);
          }
          return;
        }

        if (verdict.outcome === "block") {
          stat("blocked");
          showOverlay({
            label,
            decision,
            statusText: "blocked",
            error:
              verdict.reason === "jev_block"
                ? "Jev hard-blocked this click."
                : undefined,
            onAllow: () => {
              stat("proceeded");
              fireClick(clickable);
            },
            onBlock: () => {},
          });
          return;
        }

        stat("asked");
        showOverlay({
          label,
          decision,
          statusText: "confirm",
          error: verdict.reason.startsWith("unreadable")
            ? "Jev's answer could not be read — confirm manually."
            : undefined,
          onAllow: () => {
            stat("proceeded");
            fireClick(clickable);
          },
          onBlock: () => {
            stat("blocked");
          },
        });
      })();
    },
    true,
  );
}


chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "askjev.dom.snapshot") {
    try {
      clearAskjevIds();
      const elements = snapshotElements(80);
      const state = formatSnapshotForJev(String(msg.goal || ""), elements);
      sendResponse({ ok: true, elements, state });
    } catch (e) {
      sendResponse({ ok: false, error: String((e as Error).message || e) });
    }
    return true;
  }
  if (msg?.type === "askjev.dom.execute") {
    void executeAction({
      action: msg.action as DomAction,
      targetId: msg.targetId,
      text: msg.text,
    }).then((r) => sendResponse(r));
    return true;
  }
  return undefined;
});
