// src/options.ts
async function loadOptions() {
  const s = await chrome.storage.sync.get(null);
  document.getElementById("apiKey").value = s.apiKey || "";
  document.getElementById("sensitivity").value = s.sensitivity || "balanced";
  document.getElementById("keywords").value = (s.customKeywords || []).join(", ");
  document.getElementById("allowlist").value = (s.allowlist || []).join("\n");
  document.getElementById("enabled").checked = s.enabled !== false;
  document.getElementById("confirmAsk").checked = s.requireConfirmOnAsk !== false;
}
document.getElementById("save").addEventListener("click", () => {
  void (async () => {
    const apiKey = document.getElementById("apiKey").value.trim();
    const sensitivity = document.getElementById("sensitivity").value;
    const customKeywords = document.getElementById("keywords").value.split(",").map((x) => x.trim()).filter(Boolean);
    const allowlist = document.getElementById("allowlist").value.split(/\n+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    await chrome.storage.sync.set({
      apiKey,
      sensitivity,
      customKeywords,
      allowlist,
      enabled: document.getElementById("enabled").checked,
      requireConfirmOnAsk: document.getElementById("confirmAsk").checked,
      model: "jev-latest"
    });
    document.getElementById("status").textContent = "saved";
  })();
});
void loadOptions();
//# sourceMappingURL=options.js.map
