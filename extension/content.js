(() => {
  const RISK_RE =
    /\b(buy|purchase|pay|checkout|confirm payment|place order|delete|remove forever|destroy|send|submit|approve|deploy|merge|transfer|withdraw|unsubscribe|cancel subscription)\b/i;

  let busy = false;
  let overlayEl = null;

  function labelFor(el) {
    if (!(el instanceof Element)) return "";
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, 120);
    if (el instanceof HTMLInputElement) {
      return (el.value || el.name || el.type || "").slice(0, 120);
    }
    return el.tagName;
  }

  function isRiskTarget(el) {
    if (!(el instanceof Element)) return false;
    const clickable =
      el.closest("button, a, [role='button'], input[type='submit'], input[type='button']") ||
      el;
    const label = labelFor(clickable);
    const href =
      clickable instanceof HTMLAnchorElement ? clickable.href || "" : "";
    return RISK_RE.test(label) || RISK_RE.test(href);
  }

  function pageSnippet() {
    const title = document.title || "";
    const url = location.href;
    const h1 = document.querySelector("h1")?.innerText?.slice(0, 160) || "";
    const body = (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 1200);
    return { title, url, h1, body };
  }

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement("div");
    overlayEl.id = "veto-overlay";
    overlayEl.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      .wrap {
        position: fixed; inset: 0; z-index: 2147483647;
        background: rgba(9,9,11,.72);
        display: flex; align-items: center; justify-content: center;
        font-family: ui-sans-serif, system-ui, sans-serif;
      }
      .card {
        width: min(420px, 92vw);
        background: #09090b;
        color: #fafafa;
        border: 1px solid #27272a;
        border-radius: 14px;
        padding: 18px;
        box-shadow: 0 20px 60px rgba(0,0,0,.5);
      }
      h1 { font-size: 16px; margin: 0 0 8px; }
      .muted { color: #a1a1aa; font-size: 12px; margin: 0 0 12px; line-height: 1.4; }
      .row { display: flex; justify-content: space-between; font-size: 13px; margin: 6px 0; }
      .val { color: #fafafa; font-variant-numeric: tabular-nums; }
      .btns { display: flex; gap: 8px; margin-top: 14px; }
      button {
        flex: 1; border: 0; border-radius: 8px; padding: 10px; font-weight: 600; cursor: pointer;
      }
      .allow { background: #fafafa; color: #09090b; }
      .block { background: #27272a; color: #fafafa; }
      .err { color: #fb7185; font-size: 12px; margin-top: 8px; }
    `;
    overlayEl.shadowRoot.appendChild(style);
    const root = document.createElement("div");
    root.className = "wrap";
    root.innerHTML = `<div class="card"><h1>Veto</h1><p class="muted" id="m"></p><div id="stats"></div><div class="btns" id="btns"></div><div class="err" id="err"></div></div>`;
    overlayEl.shadowRoot.appendChild(root);
    document.documentElement.appendChild(overlayEl);
    return overlayEl;
  }

  function hideOverlay() {
    overlayEl?.remove();
    overlayEl = null;
  }

  function showOverlay({ label, decision, error, onAllow, onBlock }) {
    const root = ensureOverlay().shadowRoot;
    root.getElementById("m").textContent = `Click “${label}” paused for Jev.`;
    const stats = root.getElementById("stats");
    const err = root.getElementById("err");
    const btns = root.getElementById("btns");
    err.textContent = error || "";
    if (decision) {
      const irr = decision.irreversible?.noul;
      const risk = decision.risk?.score;
      const action = decision.action?.choice;
      stats.innerHTML = `
        <div class="row"><span>irreversible</span><span class="val">${irr != null ? Number(irr).toFixed(3) : "—"}</span></div>
        <div class="row"><span>risk score</span><span class="val">${risk != null ? Number(risk).toFixed(2) : "—"}</span></div>
        <div class="row"><span>jev says</span><span class="val">${action || "—"}</span></div>
      `;
    } else {
      stats.innerHTML = `<div class="muted">asking jev…</div>`;
    }
    btns.innerHTML = "";
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
  }

  function normalizeAnswers(result) {
    // Support both { answers: {...} } and flat question maps
    const a = result?.answers ?? result?.questions ?? result;
    if (!a || typeof a !== "object") return null;
    return {
      irreversible: a.irreversible,
      risk: a.risk,
      action: a.action,
    };
  }

  async function decide(label) {
    const snippet = pageSnippet();
    const state = [
      `url: ${snippet.url}`,
      `title: ${snippet.title}`,
      `h1: ${snippet.h1}`,
      `button_label: ${label}`,
      `page_text: ${snippet.body}`,
    ].join("\n");

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "veto.decide", state }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(resp);
      });
    });
  }

  document.addEventListener(
    "click",
    async (ev) => {
      if (busy) return;
      const t = ev.target;
      if (!(t instanceof Element)) return;
      if (!isRiskTarget(t)) return;
      const clickable =
        t.closest("button, a, [role='button'], input[type='submit'], input[type='button']") ||
        t;
      const label = labelFor(clickable) || "unknown";

      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();

      busy = true;
      showOverlay({
        label,
        decision: null,
        onAllow: () => {},
        onBlock: () => {},
      });

      const resp = await decide(label);
      busy = false;

      if (!resp?.ok) {
        const err =
          resp?.error === "missing_api_key"
            ? "Add your TypeSafe API key in the Veto extension popup."
            : `Jev error: ${resp?.error || "unknown"}`;
        showOverlay({
          label,
          decision: null,
          error: err,
          onAllow: () => {
            // user overrides
            clickable.dispatchEvent(
              new MouseEvent("click", { bubbles: true, cancelable: true, view: window }),
            );
          },
          onBlock: () => {},
        });
        return;
      }

      const decision = normalizeAnswers(resp.result);
      const choice = decision?.action?.choice;
      const irr = Number(decision?.irreversible?.noul ?? 0);
      const autoBlock = choice === "block" || (choice === "ask" && irr >= 0.7);

      if (choice === "proceed" && !autoBlock) {
        hideOverlay();
        // allow synthetic follow-up without re-intercept storm
        const prev = busy;
        busy = true;
        clickable.click();
        setTimeout(() => {
          busy = prev;
        }, 300);
        return;
      }

      showOverlay({
        label,
        decision,
        error: autoBlock ? "hard block from jev" : undefined,
        onAllow: () => {
          busy = true;
          clickable.click();
          setTimeout(() => {
            busy = false;
          }, 300);
        },
        onBlock: () => {},
      });
    },
    true,
  );
})();
