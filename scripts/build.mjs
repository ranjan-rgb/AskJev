import * as esbuild from "esbuild";
import { mkdirSync, writeFileSync, copyFileSync, existsSync, readdirSync } from "node:fs";
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
  },
  bundle: true,
  outdir: outDir,
  format: "esm",
  target: "chrome120",
  sourcemap: true,
  logLevel: "info",
});

const manifest = {
  manifest_version: 3,
  name: "AskJev",
  version: "1.2.0",
  description:
    "Ask TypeSafe Jev before dangerous clicks on every website — not just payments.",
  permissions: ["storage", "alarms"],
  host_permissions: ["https://api.typesafe.ai/*"],
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
  background: { service_worker: "background.js", type: "module" },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["content.js"],
      run_at: "document_start",
      all_frames: true,
    },
  ],
};
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// keep icons if present
console.log("build ok");
