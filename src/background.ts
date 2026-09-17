import { DEFAULTS, type AskJevSettings } from "./defaults.js";
import { callJev } from "./jev.js";

async function getSettings(): Promise<AskJevSettings> {
  const stored = (await chrome.storage.sync.get(null)) as Partial<AskJevSettings>;
  return {
    ...DEFAULTS,
    ...stored,
    stats: { ...DEFAULTS.stats, ...(stored.stats || {}) },
  };
}

async function bumpStat(key: keyof AskJevSettings["stats"]): Promise<void> {
  const s = await getSettings();
  const stats = { ...s.stats, [key]: (s.stats?.[key] || 0) + 1 };
  await chrome.storage.sync.set({ stats });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "askjev.decide") {
    void (async () => {
      try {
        const settings = await getSettings();
        if (!settings.enabled) {
          sendResponse({ ok: true, bypass: true, reason: "disabled" });
          return;
        }
        const apiKey = settings.apiKey;
        if (!apiKey || !String(apiKey).trim()) {
          sendResponse({ ok: false, error: "missing_api_key" });
          return;
        }
        const result = await callJev({
          state: String(msg.state ?? ""),
          apiKey,
          model: settings.model,
          sensitivity: settings.sensitivity,
        });
        sendResponse({
          ok: true,
          result,
          settings: {
            sensitivity: settings.sensitivity,
            requireConfirmOnAsk: settings.requireConfirmOnAsk,
            showOverlayOnProceed: settings.showOverlayOnProceed,
          },
        });
      } catch (err) {
        await bumpStat("errors");
        const e = err as Error & { status?: number };
        sendResponse({
          ok: false,
          error: String(e?.message ?? err),
          status: e?.status,
        });
      }
    })();
    return true;
  }

  if (msg?.type === "askjev.stat") {
    void bumpStat(msg.key).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg?.type === "askjev.getSettings") {
    void getSettings().then((s) => {
      const { apiKey, ...rest } = s;
      sendResponse({
        ok: true,
        settings: { ...rest, hasKey: Boolean(apiKey && String(apiKey).trim()) },
      });
    });
    return true;
  }
  return undefined;
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    void (async () => {
      const cur = await chrome.storage.sync.get(null);
      await chrome.storage.sync.set({ ...DEFAULTS, ...cur });
      chrome.runtime.openOptionsPage();
    })();
  }
});
