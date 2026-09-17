// src/defaults.ts
var BASE_KEYWORDS = [
  // money
  "buy",
  "purchase",
  "pay",
  "checkout",
  "place order",
  "confirm payment",
  "order now",
  "complete purchase",
  "add card",
  "wire",
  "payout",
  "transfer",
  "withdraw",
  "deposit",
  "subscribe",
  "unsubscribe",
  "cancel subscription",
  "upgrade",
  "downgrade",
  // destroy / mutate
  "delete",
  "remove forever",
  "destroy",
  "erase",
  "wipe",
  "purge",
  "archive",
  "revoke",
  "disable",
  "deactivate",
  "terminate",
  "close account",
  "reset",
  // communicate / commit
  "send",
  "submit",
  "publish",
  "post",
  "share",
  "invite",
  "confirm",
  "accept",
  "agree",
  "authorize",
  "approve",
  "grant access",
  // ship / prod
  "deploy",
  "merge",
  "release",
  "promote",
  "roll out",
  "execute",
  "run workflow",
  "i understand",
  "yes, delete",
  "permanently"
];
var DESTRUCTIVE_CLASS_RE = /\b(danger|destructive|error|warning|btn-danger|btn-error|bg-red|text-red)\b/i;

// src/dom.ts
var INTERACTIVE = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [onclick]';
function snapshotElements(limit = 80) {
  const nodes = Array.from(document.querySelectorAll(INTERACTIVE));
  const out = [];
  let id = 1;
  for (const el of nodes) {
    if (!(el instanceof HTMLElement)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") continue;
    const name = (el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("title") || (el instanceof HTMLInputElement ? el.value : "") || el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
    out.push({
      id,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || "",
      name,
      value: el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? String(el.value || "").slice(0, 80) : "",
      href: el instanceof HTMLAnchorElement ? el.href.slice(0, 200) : "",
      type: el instanceof HTMLInputElement ? el.type : ""
    });
    el.dataset.askjevId = String(id);
    id += 1;
    if (out.length >= limit) break;
  }
  return out;
}
function clearAskjevIds() {
  document.querySelectorAll("[data-askjev-id]").forEach((el) => {
    delete el.dataset.askjevId;
  });
}
function findByAskjevId(id) {
  return document.querySelector(`[data-askjev-id="${id}"]`);
}
async function executeAction(input) {
  const { action, targetId, text } = input;
  if (action === "DONE") return { ok: true, detail: "done" };
  if (action === "BLOCKED") return { ok: false, detail: "blocked by jev" };
  if (action === "WAIT") {
    await new Promise((r) => setTimeout(r, 800));
    return { ok: true, detail: "waited" };
  }
  if (action === "SCROLL_DOWN") {
    window.scrollBy(0, Math.floor(window.innerHeight * 0.8));
    return { ok: true, detail: "scrolled down" };
  }
  if (action === "SCROLL_UP") {
    window.scrollBy(0, -Math.floor(window.innerHeight * 0.8));
    return { ok: true, detail: "scrolled up" };
  }
  if (targetId == null) return { ok: false, detail: "missing target" };
  const el = findByAskjevId(targetId);
  if (!el) return { ok: false, detail: `element ${targetId} gone` };
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  await new Promise((r) => setTimeout(r, 200));
  if (action === "CLICK") {
    el.click();
    return { ok: true, detail: `clicked #${targetId}` };
  }
  if (action === "TYPE_TEXT") {
    const value = text ?? "";
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, detail: `typed into #${targetId}` };
    }
    el.focus();
    return { ok: false, detail: "target not typable" };
  }
  if (action === "SELECT") {
    if (el instanceof HTMLSelectElement) {
      if (text) {
        const opt = Array.from(el.options).find(
          (o) => o.text.toLowerCase().includes(text.toLowerCase())
        );
        if (opt) el.value = opt.value;
      }
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, detail: `selected #${targetId}` };
    }
    return { ok: false, detail: "not a select" };
  }
  return { ok: false, detail: `unknown action ${action}` };
}
function formatSnapshotForJev(goal, elements) {
  const lines = elements.map(
    (e) => `#${e.id} <${e.tag}${e.type ? ` type=${e.type}` : ""}${e.role ? ` role=${e.role}` : ""}> name="${e.name}" value="${e.value}" href="${e.href}"`
  );
  return [
    `goal: ${goal}`,
    `url: ${location.href}`,
    `title: ${document.title}`,
    `visible_elements:`,
    ...lines
  ].join("\n");
}

// src/content.ts
if (!window.__askjevLoaded) {
  let refreshSettings = function() {
    try {
      chrome.runtime.sendMessage({ type: "askjev.getSettings" }, (resp) => {
        if (chrome.runtime.lastError || !resp?.ok) return;
        settingsCache = { ...settingsCache, ...resp.settings };
      });
    } catch {
    }
  }, hostAllowed = function(hostname) {
    return (settingsCache.allowlist || []).some(
      (d) => hostname === d || hostname.endsWith(`.${d}`)
    );
  }, riskRegex = function() {
    const extra = (settingsCache.customKeywords || []).map((k) => String(k).trim()).filter(Boolean);
    const all = [...BASE_KEYWORDS, ...extra].map(
      (k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    );
    return new RegExp(`\\b(${all.join("|")})\\b`, "i");
  }, labelFor = function(el) {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim().slice(0, 160);
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, 160);
    if (el instanceof HTMLInputElement) {
      return (el.value || el.name || el.type || "").slice(0, 160);
    }
    return el.tagName;
  }, clickableFrom = function(el) {
    return el.closest(
      "button, a, [role='button'], input[type='submit'], input[type='button']"
    ) || el;
  }, isRiskTarget = function(el) {
    const clickable = clickableFrom(el);
    const label = labelFor(clickable);
    const href = clickable instanceof HTMLAnchorElement ? clickable.href || "" : "";
    const re = riskRegex();
    if (re.test(label) || re.test(href)) return true;
    const className = typeof clickable.className === "string" ? clickable.className : "";
    if (DESTRUCTIVE_CLASS_RE.test(className)) return true;
    const isSubmit = clickable instanceof HTMLInputElement && (clickable.type === "submit" || clickable.type === "button") || clickable instanceof HTMLButtonElement && (clickable.type === "submit" || clickable.type === "button");
    const inForm = Boolean(clickable.closest("form"));
    const paranoid = settingsCache.sensitivity === "paranoid" || settingsCache.gateFormSubmits === true;
    if (paranoid && isSubmit && inForm) return true;
    const generic = /^(ok|yes|continue|next|done|save|apply|go)$/i.test(label.trim());
    if (isSubmit && inForm && generic) return true;
    return false;
  }, pageSnippet = function() {
    return {
      title: document.title || "",
      url: location.href,
      h1: document.querySelector("h1")?.textContent?.slice(0, 160) || "",
      body: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 1400)
    };
  }, hideOverlay = function() {
    overlayHost?.remove();
    overlayHost = null;
  }, escapeHtml = function(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }, fmt = function(n, d) {
    if (n == null || Number.isNaN(Number(n))) return "\u2014";
    return Number(n).toFixed(d);
  }, showOverlay = function(opts) {
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
        <p class="brand">AskJev \xB7 TypeSafe Jev</p>
        <h1>Ask Jev before this click</h1>
        <p class="muted">\u201C${escapeHtml(opts.label)}\u201D ${opts.statusText ? `<span class="pill">${escapeHtml(opts.statusText)}</span>` : ""}</p>
        <div id="stats"></div>
        <div class="btns" id="btns"></div>
        <div class="err" id="err"></div>
      </div></div>
    `;
    const stats = shadow.getElementById("stats");
    const err = shadow.getElementById("err");
    const btns = shadow.getElementById("btns");
    err.textContent = opts.error || "";
    if (opts.decision) {
      const irr = opts.decision.irreversible?.noul;
      const risk = opts.decision.risk?.score;
      const action = opts.decision.action?.choice;
      const conf = opts.decision.action?.confidence;
      stats.innerHTML = `
        <div class="row"><span>irreversible</span><span class="val">${fmt(irr, 3)}</span></div>
        <div class="row"><span>risk</span><span class="val">${fmt(risk, 2)}</span></div>
        <div class="row"><span>jev</span><span class="val">${action || "\u2014"} ${conf != null ? `(${fmt(conf, 2)})` : ""}</span></div>
      `;
    } else if (!opts.error) {
      stats.innerHTML = `<div class="muted">asking jev\u2026</div>`;
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
    btns.append(allow, block);
    document.documentElement.appendChild(overlayHost);
  }, decide = function(label) {
    const sn = pageSnippet();
    const state = [
      `url: ${sn.url}`,
      `title: ${sn.title}`,
      `h1: ${sn.h1}`,
      `button_label: ${label}`,
      `page_text: ${sn.body}`
    ].join("\n");
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "askjev.decide", state }, (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(resp ?? { ok: false, error: "no_response" });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e?.message ?? e) });
      }
    });
  }, fireClick = function(el) {
    passThroughUntil = Date.now() + 800;
    busy = true;
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
    );
    setTimeout(() => {
      busy = false;
    }, 400);
  }, stat = function(key) {
    try {
      chrome.runtime.sendMessage({ type: "askjev.stat", key });
    } catch {
    }
  };
  refreshSettings2 = refreshSettings, hostAllowed2 = hostAllowed, riskRegex2 = riskRegex, labelFor2 = labelFor, clickableFrom2 = clickableFrom, isRiskTarget2 = isRiskTarget, pageSnippet2 = pageSnippet, hideOverlay2 = hideOverlay, escapeHtml2 = escapeHtml, fmt2 = fmt, showOverlay2 = showOverlay, decide2 = decide, fireClick2 = fireClick, stat2 = stat;
  window.__askjevLoaded = true;
  let settingsCache = {
    enabled: true,
    customKeywords: [],
    allowlist: [],
    hasKey: false
  };
  let busy = false;
  let overlayHost = null;
  let passThroughUntil = 0;
  refreshSettings();
  setInterval(refreshSettings, 5e3);
  document.addEventListener(
    "click",
    (ev) => {
      void (async () => {
        if (Date.now() < passThroughUntil) return;
        if (busy) return;
        if (!settingsCache.enabled) return;
        if (hostAllowed(location.hostname)) return;
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
          onAllow: () => {
          },
          onBlock: () => {
          }
        });
        const resp = await decide(label);
        busy = false;
        if (resp?.bypass) {
          hideOverlay();
          fireClick(clickable);
          return;
        }
        if (!resp?.ok) {
          const err = resp?.error === "missing_api_key" ? "Add your TypeSafe API key in AskJev options." : `Jev error: ${resp?.error || "unknown"}`;
          showOverlay({
            label,
            decision: null,
            error: err,
            statusText: "error",
            onAllow: () => fireClick(clickable),
            onBlock: () => {
            }
          });
          return;
        }
        const decision = resp.result?.answers ?? null;
        const choice = decision?.action?.choice;
        const irr = Number(decision?.irreversible?.noul ?? 0);
        const conf = Number(decision?.action?.confidence ?? 0);
        if (choice === "proceed" && conf >= 0.45 && irr < 0.55) {
          stat("proceeded");
          if (resp.settings?.showOverlayOnProceed) {
            showOverlay({
              label,
              decision,
              statusText: "proceed",
              onAllow: () => fireClick(clickable),
              onBlock: () => {
              }
            });
          } else {
            hideOverlay();
            fireClick(clickable);
          }
          return;
        }
        if (choice === "block" || choice === "ask" && irr >= 0.65) {
          stat("blocked");
          showOverlay({
            label,
            decision,
            statusText: "blocked",
            error: choice === "block" ? "Jev hard-blocked this click." : void 0,
            onAllow: () => {
              stat("proceeded");
              fireClick(clickable);
            },
            onBlock: () => {
            }
          });
          return;
        }
        stat("asked");
        showOverlay({
          label,
          decision,
          statusText: "confirm",
          onAllow: () => {
            stat("proceeded");
            fireClick(clickable);
          },
          onBlock: () => {
            stat("blocked");
          }
        });
      })();
    },
    true
  );
}
var refreshSettings2;
var hostAllowed2;
var riskRegex2;
var labelFor2;
var clickableFrom2;
var isRiskTarget2;
var pageSnippet2;
var hideOverlay2;
var escapeHtml2;
var fmt2;
var showOverlay2;
var decide2;
var fireClick2;
var stat2;
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "askjev.dom.snapshot") {
    try {
      clearAskjevIds();
      const elements = snapshotElements(80);
      const state = formatSnapshotForJev(String(msg.goal || ""), elements);
      sendResponse({ ok: true, elements, state });
    } catch (e) {
      sendResponse({ ok: false, error: String(e.message || e) });
    }
    return true;
  }
  if (msg?.type === "askjev.dom.execute") {
    void executeAction({
      action: msg.action,
      targetId: msg.targetId,
      text: msg.text
    }).then((r) => sendResponse(r));
    return true;
  }
  return void 0;
});
//# sourceMappingURL=content.js.map
