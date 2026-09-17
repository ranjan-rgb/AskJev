const keyEl = document.getElementById("key");
const statusEl = document.getElementById("status");

chrome.storage.sync.get(["apiKey"]).then(({ apiKey }) => {
  if (apiKey) keyEl.value = apiKey;
});

document.getElementById("save").addEventListener("click", async () => {
  const apiKey = keyEl.value.trim();
  await chrome.storage.sync.set({ apiKey });
  statusEl.textContent = apiKey ? "saved" : "cleared";
});
