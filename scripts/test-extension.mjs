#!/usr/bin/env node
/**
 * Extension + packaging unit checks (no browser).
 * Asserts zinc ops HTML (no neon palette), version sync, MV3 manifest, build outputs.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

function ok(msg) {
  console.error("ok:", msg);
}

// --- version sync ---
const mcpVer = JSON.parse(readFileSync(join(root, "mcp/package.json"), "utf8")).version;
assert.equal(mcpVer, version, `mcp version ${mcpVer} != root ${version}`);
const mcpbMan = JSON.parse(readFileSync(join(root, "mcpb/manifest.json"), "utf8"));
assert.equal(mcpbMan.version, version, `mcpb manifest version mismatch`);
assert.equal(mcpbMan.manifest_version, "0.3");
assert.equal(mcpbMan.server?.entry_point, "server/index.js");
// The API key is the one thing the user must supply, and it must never be
// stored in the clear — Claude only encrypts user_config marked sensitive.
assert.ok(
  mcpbMan.user_config?.typesafe_api_key?.sensitive,
  "mcpb TypeSafe API key must be marked sensitive",
);
assert.ok(
  mcpbMan.user_config?.typesafe_api_key?.required,
  "mcpb TypeSafe API key must be required",
);
// CDP is the product path: the bundle must not ask a normal user for a pairing
// token or a port, and must launch in cdp mode.
assert.equal(mcpbMan.server?.mcp_config?.env?.ASKJEV_MODE, "cdp");
assert.ok(
  !mcpbMan.user_config?.askjev_token,
  "mcpb must not require a pairing token — that is the legacy bridge path",
);
ok(`versions aligned @ ${version}`);

// --- neon / zinc HTML ---
const neon = [
  /#0{0,2}[fF]{2}0{2,4}\b/, // pure neon green-ish
  /#00ff00/i,
  /#39ff14/i,
  /#00ffff/i,
  /#ff00ff/i,
  /neon/i,
  /text-shadow\s*:[^;]*0\s+0\s+\d+px/,
  /box-shadow\s*:[^;]*0\s+0\s+\d+px\s+[^;]*(?:#0ff|#f0f|#0f0)/i,
];
const brightStatus = [/#4ade80/i, /#22c55e/i, /#fbbf24/i, /#f87171/i];
for (const name of ["popup.html", "options.html", "sidepanel.html"]) {
  const html = readFileSync(join(root, "extension", name), "utf8");
  // Tailwind zinc ops console (e4f5191+) — CSS vars may live in ui.css
  const zincOk =
    html.includes("--bg: #09090b") ||
    html.includes("bg-zinc-900") ||
    html.includes("bg-zinc-950");
  const cardOk =
    html.includes("--card: #18181b") ||
    html.includes("border-zinc-800") ||
    html.includes("bg-zinc-900");
  assert.ok(zincOk, `${name} missing zinc bg`);
  assert.ok(cardOk, `${name} missing zinc card`);
  const focusOk =
    html.includes(":focus-visible") ||
    readFileSync(join(root, "extension", "ui.css"), "utf8").includes(":focus-visible");
  assert.ok(focusOk, `${name} missing focus-visible`);
  for (const re of neon) {
    if (re.test(html)) fail(`${name} matches neon pattern ${re}`);
  }
  for (const re of brightStatus) {
    if (re.test(html)) fail(`${name} still uses bright status color ${re}`);
  }
  if (name === "popup.html" || name === "options.html") {
    assert.ok(html.includes(`v${version}`) || html.includes(version), `${name} should mention v${version}`);
  }
  ok(`${name} zinc ops`);
}

// --- build extension ---
execSync("npm run build:extension", { cwd: root, stdio: "inherit" });
const man = JSON.parse(readFileSync(join(root, "extension/manifest.json"), "utf8"));
assert.equal(man.manifest_version, 3);
assert.equal(man.version, version);
assert.ok(Array.isArray(man.permissions) && man.permissions.includes("offscreen"), "manifest needs offscreen permission");
ok("offscreen permission");
for (const f of [
  "background.js",
  "content.js",
  "popup.js",
  "options.js",
  "sidepanel.js",
  "offscreen.js",
  "popup.html",
  "options.html",
  "sidepanel.html",
  "offscreen.html",
]) {
  const p = join(root, "extension", f);
  assert.ok(existsSync(p), `missing ${f}`);
  assert.ok(statSync(p).size > 50, `${f} too small`);
}
ok("extension build + manifest");

// --- mcpb manifest required fields ---
for (const k of ["name", "description", "author", "server", "license"]) {
  assert.ok(mcpbMan[k], `mcpb.manifest missing ${k}`);
}
assert.equal(mcpbMan.server.type, "node");
assert.ok(Array.isArray(mcpbMan.server.mcp_config?.args));
ok("mcpb manifest shape");

// --- pack scripts exist ---
for (const s of ["pack-mcpb.mjs", "pack-chrome.mjs", "build.mjs"]) {
  assert.ok(existsSync(join(root, "scripts", s)), `missing scripts/${s}`);
}
ok("pack scripts present");

console.error(`\nAll extension checks passed (${version}).`);
