import * as esbuild from "esbuild";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const outDir = "extension";
mkdirSync(outDir, { recursive: true });
mkdirSync(join(outDir, "icons"), { recursive: true });

await esbuild.build({
  entryPoints: {
    background: "src/background.ts",
    content: "src/content.ts",
    popup: "src/popup.ts",
    options: "src/options.ts",
    sidepanel: "src/sidepanel.ts",
  },
  bundle: true,
  outdir: outDir,
  format: "esm",
  target: "chrome120",
  sourcemap: process.env.ASKJEV_DEV === "1",
  minify: process.env.ASKJEV_DEV !== "1",
  logLevel: "info",
});

const manifest = {
  manifest_version: 3,
  name: "AskJev",
  version: "1.5.2",
  description:
    "Jev autopilot for any website — plus a guard on irreversible clicks. Connect Claude/Cursor via MCP agent bridge.",
  permissions: ["storage", "alarms", "sidePanel", "activeTab", "tabs"],
  host_permissions: [
    "https://api.typesafe.ai/*",
    "http://*/*",
    "https://*/*",
    "ws://127.0.0.1/*",
    "ws://localhost/*",
  ],
  action: {
    default_title: "AskJev",
    default_popup: "popup.html",
    default_icon: {
      16: "icons/icon16.png",
      32: "icons/icon32.png",
      48: "icons/icon48.png",
      128: "icons/icon128.png",
    },
  },
  icons: {
    16: "icons/icon16.png",
    32: "icons/icon32.png",
    48: "icons/icon48.png",
    128: "icons/icon128.png",
  },
  options_ui: { page: "options.html", open_in_tab: true },
  side_panel: { default_path: "sidepanel.html" },
  background: { service_worker: "background.js", type: "module" },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["content.js"],
      run_at: "document_idle",
      all_frames: false,
    },
  ],
};
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

if (!existsSync(join(outDir, "sidepanel.html"))) {
  console.warn("missing sidepanel.html");
}
console.log("build ok");
