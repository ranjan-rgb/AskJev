(() => {
  if (window.__askjevLoaded) return;
  window.__askjevLoaded = true;

  const BASE = [
    "buy", "purchase", "pay", "checkout", "place order", "confirm payment",
    "delete", "remove forever", "destroy", "send", "submit", "approve",
    "deploy", "merge", "transfer", "withdraw", "unsubscribe",
    "cancel subscription", "wire", "payout",
  ];

  let settingsCache = {
    enabled: true,
    customKeywords: [],
    allowlist: [],
    hasKey: false,
  };
  let busy = false;
  let overlayHost = null;
  let passThroughUntil = 0;

  function refreshSettings() {
    try {
      chrome.runtime.sendMessage({ type: "askjev.getSettings" }, (resp) => {
        if (chrome.runtime.lastError || !resp?.ok) return;
        settingsCache = { ...settingsCache, ...resp.settings };
      });
    } catch {
      /* extension context invalidated */
    }
  }
  refreshSettings();
  setInterval(refreshSettings, 5000);

  function hostAllowed(hostname) {
    const list = settingsCache.allowlist || [];
    return list.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  }

  function riskRegex() {
    const extra = (settingsCache.customKeywords || [])
      .map((k) => String(k).trim())
      .filter(Boolean);
    const all = [...BASE, ...extra].map((k) =>
      k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    return new RegExp(`\\b(${all.join("|")})\\b`, "i");
  }

  function labelFor(el) {
    if (!(el instanceof Element)) return "";
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim().slice(0, 160);
    const text = (el.innerText || el.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    if (text) return text.slice(0, 160);
    if (el instanceof HTMLInputElement) {
      return (el.value || el.name || el.type || "").slice(0, 160);
    }
    return el.tagName;
  }

  function clickableFrom(el) {
    return (
      el.closest(
        "button, a, [role='button'], input[type='submit'], input[type='button']",
      ) || el
    );
  }

  function isRiskTarget(el) {
    if (!(el instanceof Element)) return false;
    const clickable = clickableFrom(el);
    const label = labelFor(clickable);
    const href =
      clickable instanceof HTMLAnchorElement ? clickable.href || "" : "";
    const re = riskRegex();
    return re.test(label) || re.test(href);
  }

  function pageSnippet() {
    return {
      title: document.title || "",
      url: location.href,
      h1: document.querySelector("h1")?.innerText?.slice(0, 160) || "",
      body: (document.body?.innerText || "")
        .replace(/\s+/g, " ")
        .slice(0, 1400),
    };
  }

  function hideOverlay() {
    overlayHost?.remove();
    overlayHost = null;
  }

  function showOverlay({ label, decision, error, statusText, onAllow, onBlock }) {
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
        <p class="brand">AskJev · powered by Jev</p>
        <h1>Hold fire on this click</h1>
        <p class="muted">“${escapeHtml(label)}” ${statusText ? `<span class="pill">${escapeHtml(statusText)}</span>` : ""}</p>
        <div id="stats"></div>
        <div class="btns" id="btns"></div>
        <div class="err" id="err"></div>
      </div></div>
    `;
    const stats = shadow.getElementById("stats");
    const err = shadow.getElementById("err");
    const btns = shadow.getElementById("btns");
    err.textContent = error || "";
    if (decision) {
      const irr = decision.irreversible?.noul;
      const risk = decision.risk?.score;
      const action = decision.action?.choice;
      const conf = decision.action?.confidence;
      stats.innerHTML = `
        <div class="row"><span>irreversible</span><span class="val">${fmt(irr, 3)}</span></div>
        <div class="row"><span>risk</span><span class="val">${fmt(risk, 2)}</span></div>
        <div class="row"><span>jev</span><span class="val">${action || "—"} ${conf != null ? `(${fmt(conf, 2)})` : ""}</span></div>
      `;
    } else if (!error) {
      stats.innerHTML = `<div class="muted">asking jev…</div>`;
    }
    const allow = document.createElement("button");
    allow.className = "allow";
    allow.textContent = "Allow once";
    allow.onclick = () => {
      hideOverlay();
      onAllow();
    };
    const block = document.createElement("button");
    block.className = "block";
    block.textContent = "Keep blocked";
    block.onclick = () => {
      hideOverlay();
      onBlock();
    };
    btns.append(allow, block);
    document.documentElement.appendChild(overlayHost);
  }

  function fmt(n, d) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    return Number(n).toFixed(d);
  }
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizeAnswers(result) {
    const a = result?.answers ?? result;
    if (!a || typeof a !== "object") return null;
    return {
      irreversible: a.irreversible,
      risk: a.risk,
      action: a.action,
    };
  }

  function decide(label) {
    const sn = pageSnippet();
    const state = [
      `url: ${sn.url}`,
      `title: ${sn.title}`,
      `h1: ${sn.h1}`,
      `button_label: ${label}`,
      `page_text: ${sn.body}`,
    ].join("\n");
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: "askjev.decide", state },
          (resp) => {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, error: chrome.runtime.lastError.message });
              return;
            }
            resolve(resp);
          },
        );
      } catch (e) {
        resolve({ ok: false, error: String(e?.message ?? e) });
      }
    });
  }

  function fireClick(el) {
    passThroughUntil = Date.now() + 800;
    busy = true;
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, view: window }),
    );
    setTimeout(() => {
      busy = false;
    }, 400);
  }

  function stat(key) {
    try {
      chrome.runtime.sendMessage({ type: "askjev.stat", key });
    } catch {
      /* ignore */
    }
  }

  document.addEventListener(
    "click",
    async (ev) => {
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
            ? "Add your TypeSafe API key in AskJev options (extension icon → Options)."
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

      const decision = normalizeAnswers(resp.result);
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
            onBlock: () => {},
          });
        } else {
          hideOverlay();
          fireClick(clickable);
        }
        return;
      }

      if (choice === "block" || (choice === "ask" && irr >= 0.65)) {
        stat("blocked");
        showOverlay({
          label,
          decision,
          statusText: "blocked",
          error: choice === "block" ? "Jev hard-blocked this click." : undefined,
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
        onAllow: () => {
          stat("proceeded");
          fireClick(clickable);
        },
        onBlock: () => {
          stat("blocked");
        },
      });
    },
    true,
  );
})();
