#!/usr/bin/env node
/**
 * Build askjev-mcp, stage into mcpb/server + production node_modules, pack .mcpb.
 * Does not modify mcp/src — only consumes mcp/dist.
 */
import { execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mcpbDir = join(root, "mcpb");
const serverDir = join(mcpbDir, "server");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const outPath = join(root, "store", `askjev-${version}.mcpb`);

console.error(`pack-mcpb: building mcp @ ${version}`);
execSync("npm run build", { cwd: join(root, "mcp"), stdio: "inherit" });

rmSync(serverDir, { recursive: true, force: true });
mkdirSync(serverDir, { recursive: true });

const dist = join(root, "mcp", "dist");
for (const name of readdirSync(dist)) {
  if (name.endsWith(".map") || name.endsWith(".d.ts")) continue;
  cpSync(join(dist, name), join(serverDir, name));
}

// Ensure server entry is index.js (mcp dist entry)
if (!existsSync(join(serverDir, "index.js"))) {
  console.error("pack-mcpb: missing server/index.js after copy");
  process.exit(1);
}

// Sync version into mcpb manifest + package.json
const manifestPath = join(mcpbDir, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.version = version;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

const mcpbPkgPath = join(mcpbDir, "package.json");
const mcpbPkg = JSON.parse(readFileSync(mcpbPkgPath, "utf8"));
mcpbPkg.version = version;
const mcpDeps = JSON.parse(readFileSync(join(root, "mcp", "package.json"), "utf8")).dependencies;
mcpbPkg.dependencies = mcpDeps;
writeFileSync(mcpbPkgPath, JSON.stringify(mcpbPkg, null, 2) + "\n");

console.error("pack-mcpb: installing production deps into mcpb/");
rmSync(join(mcpbDir, "node_modules"), { recursive: true, force: true });
execSync("npm install --omit=dev --no-fund --no-audit", {
  cwd: mcpbDir,
  stdio: "inherit",
});

mkdirSync(join(root, "store"), { recursive: true });
if (existsSync(outPath)) rmSync(outPath);

console.error("pack-mcpb: validating manifest");
execSync("npx --yes @anthropic-ai/mcpb validate manifest.json", {
  cwd: mcpbDir,
  stdio: "inherit",
});

console.error("pack-mcpb: packing", outPath);
execSync(`npx --yes @anthropic-ai/mcpb pack . "${outPath}"`, {
  cwd: mcpbDir,
  stdio: "inherit",
});

console.error("pack-mcpb: wrote", outPath);
