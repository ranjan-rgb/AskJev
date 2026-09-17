async function loadOptions(): Promise<void> {
  const s = await chrome.storage.sync.get(null);
  (document.getElementById("apiKey") as HTMLInputElement).value = s.apiKey || "";
  (document.getElementById("sensitivity") as HTMLSelectElement).value =
    s.sensitivity || "balanced";
  (document.getElementById("keywords") as HTMLInputElement).value = (
    s.customKeywords || []
  ).join(", ");
  (document.getElementById("allowlist") as HTMLTextAreaElement).value = (
    s.allowlist || []
  ).join("\n");
  (document.getElementById("enabled") as HTMLInputElement).checked =
    s.enabled !== false;
  (document.getElementById("confirmAsk") as HTMLInputElement).checked =
    s.requireConfirmOnAsk !== false;
  (document.getElementById("gateForms") as HTMLInputElement).checked =
    s.gateFormSubmits === true;
}

document.getElementById("save")!.addEventListener("click", () => {
  void (async () => {
    const apiKey = (
      document.getElementById("apiKey") as HTMLInputElement
    ).value.trim();
    const sensitivity = (
      document.getElementById("sensitivity") as HTMLSelectElement
    ).value;
    const customKeywords = (
      document.getElementById("keywords") as HTMLInputElement
    ).value
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const allowlist = (
      document.getElementById("allowlist") as HTMLTextAreaElement
    ).value
      .split(/\n+/)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    await chrome.storage.sync.set({
      apiKey,
      sensitivity,
      customKeywords,
      allowlist,
      enabled: (document.getElementById("enabled") as HTMLInputElement).checked,
      requireConfirmOnAsk: (
        document.getElementById("confirmAsk") as HTMLInputElement
      ).checked,
      gateFormSubmits: (
        document.getElementById("gateForms") as HTMLInputElement
      ).checked,
      model: "jev-latest",
    });
    (document.getElementById("status") as HTMLElement).textContent = "saved";
  })();
});

void loadOptions();
