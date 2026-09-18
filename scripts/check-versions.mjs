#!/usr/bin/env node
/**
 * Release version consistency check (no build, no network).
 * A release bumps root + mcp + extension manifest together — this asserts it,
 * so a half-bumped tree fails loudly here instead of shipping mismatched
 * npm package / Chrome store / MCP server versions.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return JSON.parse(readFileSync(join(root, rel), "utf8"));
}

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

function ok(msg) {
  console.error("ok:", msg);
}

// Required carriers — a release is invalid if any of these drift.
const required = [
  "package.json",
  "mcp/package.json",
  "extension/manifest.json",
];
// Packaged alongside the release; checked when present.
const optional = ["mcpb/manifest.json", "mcpb/package.json"];

const expected = read("package.json").version;
if (typeof expected !== "string" || !/^\d+\.\d+\.\d+$/.test(expected)) {
  fail(`root package.json version is not x.y.z: ${String(expected)}`);
}

const mismatched = [];
for (const rel of [...required, ...optional]) {
  if (!existsSync(join(root, rel))) {
    if (required.includes(rel)) fail(`missing ${rel}`);
    continue;
  }
  const found = read(rel).version;
  if (found !== expected) mismatched.push(`${rel} is ${String(found)}`);
}

if (mismatched.length) {
  fail(
    `version drift (root package.json is ${expected}): ${mismatched.join(", ")}\n` +
      "      Bump root, mcp, extension manifest (and mcpb) together.",
  );
}

ok(`versions in sync (${expected})`);
