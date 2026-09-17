async function load() {
  const s = await chrome.storage.sync.get(null);
  const en = document.getElementById("en");
  const on = s.enabled !== false;
  en.classList.toggle("on", on);
  document.getElementById("b").textContent = s.stats?.blocked || 0;
  document.getElementById("a").textContent = s.stats?.asked || 0;
  document.getElementById("p").textContent = s.stats?.proceeded || 0;
  document.getElementById("key").textContent = s.apiKey ? "key set" : "no key";
}
document.getElementById("en").onclick = async () => {
  const s = await chrome.storage.sync.get(["enabled"]);
  const next = !(s.enabled !== false);
  await chrome.storage.sync.set({ enabled: next });
  load();
};
document.getElementById("opts").onclick = () => chrome.runtime.openOptionsPage();
load();
