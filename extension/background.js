const API = "https://api.typesafe.ai/v1/systemone";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "veto.decide") return;
  (async () => {
    try {
      const { apiKey } = await chrome.storage.sync.get(["apiKey"]);
      if (!apiKey || !String(apiKey).trim()) {
        sendResponse({ ok: false, error: "missing_api_key" });
        return;
      }
      const body = {
        model: "jev-latest",
        state: msg.state,
        questions: {
          irreversible: {
            type: "noul",
            instructions:
              "Would this click permanently move money, delete data, send a message, or approve a production change?",
          },
          risk: {
            type: "score",
            instructions: "How dangerous is allowing this click right now?",
            criteria: [
              "Safe / reversible browsing",
              "Mild risk, easy undo",
              "Hard to undo, money or access at stake",
              "Catastrophic if wrong",
            ],
          },
          action: {
            type: "choice",
            instructions:
              "Given the button label, page context, and irreversible risk, what should Veto do?",
            criteria: {
              proceed: "Allow the click. Low risk or clearly intentional.",
              block: "Hard block. Too dangerous or likely accidental.",
              ask: "Pause and make the human confirm in the overlay.",
            },
          },
        },
      };
      const res = await fetch(API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        sendResponse({
          ok: false,
          error: `bad_json_${res.status}`,
          raw: text.slice(0, 400),
        });
        return;
      }
      if (!res.ok) {
        sendResponse({
          ok: false,
          error: `http_${res.status}`,
          raw: json,
        });
        return;
      }
      sendResponse({ ok: true, result: json });
    } catch (err) {
      sendResponse({
        ok: false,
        error: String(err?.message ?? err),
      });
    }
  })();
  return true;
});
