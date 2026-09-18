#!/usr/bin/env node
/**
 * Pure Autopilot + Guard policy regression tests (no browser, no network).
 * Bundles src/autopilot-jev.ts + src/guard-policy.ts via esbuild for Node.
 */
import { mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, ".tmp-test-logic");
mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [
    join(root, "src/autopilot-jev.ts"),
    join(root, "src/guard-policy.ts"),
    join(root, "src/defaults.ts"),
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  outdir: outDir,
  outExtension: { ".js": ".mjs" },
  logLevel: "silent",
});

const { applyAutopilotGuards } = await import(
  join(outDir, "autopilot-jev.mjs")
);
const {
  GUARD_JEV_TIMEOUT_MS,
  GUARD_DISMISS_PASSTHROUGH_MS,
  applyGuardDismiss,
  guardJevTimeoutMessage,
  isPassThroughActive,
  passThroughUntilFrom,
  resolveGuardVerdict,
  GUARD_IRREVERSIBLE_BLOCK,
} = await import(join(outDir, "guard-policy.mjs"));

function ok(msg) {
  console.error("ok:", msg);
}

// --- Autopilot: force CLICK/SCROLL when goal needs navigation ---
{
  const r = applyAutopilotGuards({
    action: "DONE",
    targetId: 7,
    goalDone: 0.99,
    step: 1,
  });
  assert.equal(r.action, "CLICK", "step1 DONE+target → CLICK");
  assert.equal(r.done, false);
  ok("step1 DONE with target forces CLICK");
}

{
  const r = applyAutopilotGuards({
    action: "DONE",
    targetId: null,
    goalDone: 0.99,
    step: 1,
  });
  assert.equal(r.action, "SCROLL_DOWN", "step1 DONE+no target → SCROLL_DOWN");
  assert.equal(r.done, false);
  ok("step1 DONE without target forces SCROLL_DOWN");
}

{
  const r = applyAutopilotGuards({
    action: "DONE",
    targetId: 3,
    goalDone: 0.5,
    step: 2,
  });
  assert.equal(r.action, "CLICK", "DONE+target on later step → CLICK");
  ok("DONE with target forces CLICK after step 1");
}

{
  const r = applyAutopilotGuards({
    action: "DONE",
    targetId: null,
    goalDone: 0.95,
    step: 4,
  });
  assert.equal(r.action, "DONE");
  assert.equal(r.done, true);
  ok("later-step DONE without target stays DONE when goal_done high");
}

{
  const r = applyAutopilotGuards({
    action: "WAIT",
    targetId: null,
    goalDone: 0.95,
    step: 3,
  });
  assert.equal(r.action, "DONE");
  ok("high goal_done promotes WAIT → DONE");
}

{
  const r = applyAutopilotGuards({
    action: "CLICK",
    targetId: 1,
    goalDone: 0.1,
    step: 1,
  });
  assert.equal(r.action, "CLICK");
  ok("normal CLICK unchanged");
}

// --- Guard dismiss ---
{
  const now = 1_000_000;
  const d = applyGuardDismiss({ now });
  assert.equal(d.busy, false);
  assert.equal(d.passThroughUntil, now + GUARD_DISMISS_PASSTHROUGH_MS);
  assert.equal(isPassThroughActive(d.passThroughUntil, now + 100), true);
  assert.equal(
    isPassThroughActive(d.passThroughUntil, now + GUARD_DISMISS_PASSTHROUGH_MS),
    false,
  );
  ok("Guard dismiss clears busy and arms pass-through");
}

{
  assert.ok(
    GUARD_JEV_TIMEOUT_MS >= 10_000,
    "Guard Jev timeout should be ≥10s (was flaky at 8s)",
  );
  assert.ok(
    GUARD_JEV_TIMEOUT_MS <= 15_000,
    "Guard timeout should stay ≤ Autopilot 15s",
  );
  assert.match(guardJevTimeoutMessage(), /Dismiss/i);
  assert.ok(passThroughUntilFrom("allow", 0) > 0);
  ok("Guard Jev timeout + message policy");
}

const {
  DEFAULTS,
  BUTTON_ONLY_KEYWORDS,
  BASE_KEYWORDS,
} = await import(join(outDir, "defaults.mjs"));

{
  assert.equal(DEFAULTS.requireConfirmOnAsk, false, "quiet Guard default");
  assert.equal(DEFAULTS.showOverlayOnProceed, false);
  assert.ok(!BUTTON_ONLY_KEYWORDS.includes("confirm"), "no bare confirm");
  assert.ok(!BUTTON_ONLY_KEYWORDS.includes("accept"), "no bare accept");
  assert.ok(!BUTTON_ONLY_KEYWORDS.includes("agree"), "no bare agree");
  assert.ok(BUTTON_ONLY_KEYWORDS.includes("confirm payment"));
  const all = [...BASE_KEYWORDS, ...BUTTON_ONLY_KEYWORDS].map((k) =>
    k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const re = new RegExp(`\\b(${all.join("|")})\\b`, "i");
  // Bare "confirm" / soft words must not match (GitHub PR titles, cookie banners)
  assert.equal(re.test("Confirm"), false, "bare Confirm must not match");
  assert.equal(re.test("please confirm later in review"), false);
  assert.equal(re.test("Accept all cookies"), true); // phrase "accept all"
  assert.equal(re.test("Accept"), false, "bare Accept must not match");
  assert.equal(re.test("Confirm payment"), true);
  assert.equal(re.test("Delete repository"), true);
  ok("quiet Guard defaults + narrow keywords");
}

{
  // Guard must never pass a click through on an answer it could not read.
  const quiet = { requireConfirmOnAsk: false };

  assert.equal(
    resolveGuardVerdict({ choice: undefined, ...quiet }).outcome,
    "confirm",
    "a 200 with no answers must ask, not allow",
  );
  assert.equal(
    resolveGuardVerdict({ choice: "", irreversible: 0, confidence: 0, ...quiet })
      .outcome,
    "confirm",
  );
  assert.equal(
    resolveGuardVerdict({ choice: "yolo", irreversible: 0, ...quiet }).outcome,
    "confirm",
    "unrecognised choice must ask",
  );
  assert.equal(
    resolveGuardVerdict({
      choice: "proceed",
      irreversible: "high",
      confidence: 0.9,
      ...quiet,
    }).outcome,
    "confirm",
    "non-numeric score must ask",
  );
  assert.equal(
    resolveGuardVerdict({ choice: "proceed", confidence: 0.9, ...quiet })
      .outcome,
    "confirm",
    "missing irreversible must ask",
  );

  // Documented behaviour that must not regress.
  assert.equal(
    resolveGuardVerdict({
      choice: "proceed",
      irreversible: 0.1,
      confidence: 0.9,
      ...quiet,
    }).outcome,
    "allow",
  );
  assert.equal(
    resolveGuardVerdict({ choice: "block", irreversible: 0.1, confidence: 0.9 })
      .outcome,
    "block",
    "a hard block wins regardless of scores",
  );
  assert.equal(
    resolveGuardVerdict({
      choice: "ask",
      irreversible: 0.7,
      confidence: 0.9,
      ...quiet,
    }).outcome,
    "block",
    "irreversible >= 0.65 freezes",
  );
  assert.equal(
    resolveGuardVerdict({
      choice: "ask",
      irreversible: 0.2,
      confidence: 0.9,
      ...quiet,
    }).outcome,
    "allow",
    "quiet default: soft ask below the gate does not freeze the page",
  );
  assert.equal(
    resolveGuardVerdict({
      choice: "ask",
      irreversible: 0.2,
      confidence: 0.9,
      requireConfirmOnAsk: true,
    }).outcome,
    "confirm",
    "requireConfirmOnAsk opts back into friction",
  );
  assert.equal(
    resolveGuardVerdict({
      choice: "proceed",
      irreversible: 0.6,
      confidence: 0.9,
      requireConfirmOnAsk: true,
    }).outcome,
    "confirm",
  );
  assert.equal(
    GUARD_IRREVERSIBLE_BLOCK,
    0.65,
    "product invariant: the freeze gate stays at 0.65",
  );
  ok("Guard fails closed on unreadable Jev answers");
}

rmSync(outDir, { recursive: true, force: true });
console.error("\nAll logic checks passed.");
