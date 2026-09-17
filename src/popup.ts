async function loadPopup(): Promise<void> {
  const s = await chrome.storage.sync.get(null);
  const en = document.getElementById("en") as HTMLButtonElement;
  const on = s.enabled !== false;
  en.classList.toggle("on", on);
  (document.getElementById("b") as HTMLElement).textContent = String(
    s.stats?.blocked || 0,
  );
  (document.getElementById("a") as HTMLElement).textContent = String(
    s.stats?.asked || 0,
  );
  (document.getElementById("p") as HTMLElement).textContent = String(
    s.stats?.proceeded || 0,
  );
  (document.getElementById("key") as HTMLElement).textContent = s.apiKey
    ? "key set"
    : "no key";
}

document.getElementById("en")!.addEventListener("click", () => {
  void (async () => {
    const s = await chrome.storage.sync.get(["enabled"]);
    const next = !(s.enabled !== false);
    await chrome.storage.sync.set({ enabled: next });
    await loadPopup();
  })();
});

document.getElementById("opts")!.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

void loadPopup();

document.getElementById("auto")?.addEventListener("click", () => {
  void (async () => {
    const win = await chrome.windows.getCurrent();
    if (win.id != null) await chrome.sidePanel.open({ windowId: win.id });
  })();
});
