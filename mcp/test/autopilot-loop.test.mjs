/**
 * Autopilot loop robustness: stuck detection, one-shot typeText,
 * confidence gating, takeover waiting, and status reset.
 * Pure helpers only — no browser, no network.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_MIN_CONFIDENCE,
  MAX_LOW_CONFIDENCE_PROBES,
  NO_PROGRESS_LIMIT,
  REPEAT_LIMIT,
  createTypeTextSource,
  detectStuck,
  gateLowConfidence,
  getAutopilotStatus,
  minConfidence,
  pageSignature,
  requestAutopilotStop,
  runJevAutopilot,
  stepKey,
  waitForRun,
} from "../dist/jev-autopilot.js";
import { resolveApiKey } from "../dist/jev-client.js";

const page = (over = {}) => ({
  url: "https://example.com/a",
  title: "A",
  elements: [
    { id: 1, role: "link", name: "Pricing" },
    { id: 2, role: "textbox", name: "Search", value: "" },
  ],
  ...over,
});

/** n identical signatures, so key-based cases are not masked by no-progress. */
const frozen = (n, sig = "S") => Array.from({ length: n }, () => sig);
/** n distinct signatures — a page that keeps changing. */
const moving = (n) => Array.from({ length: n }, (_, i) => `S${i}`);

describe("pageSignature", () => {
  it("is stable for an unchanged page", () => {
    assert.equal(pageSignature(page()), pageSignature(page()));
  });

  it("changes on url, title, or a typed-in value", () => {
    const base = pageSignature(page());
    assert.notEqual(base, pageSignature(page({ url: "https://example.com/b" })));
    assert.notEqual(base, pageSignature(page({ title: "B" })));
    assert.notEqual(
      base,
      pageSignature(
        page({
          elements: [
            { id: 1, role: "link", name: "Pricing" },
            { id: 2, role: "textbox", name: "Search", value: "shoes" },
          ],
        }),
      ),
    );
  });

  it("changes when new elements appear (lazy-loaded list)", () => {
    const more = page();
    more.elements = [...more.elements, { id: 3, role: "link", name: "Docs" }];
    assert.notEqual(pageSignature(page()), pageSignature(more));
  });
});

describe("detectStuck", () => {
  it("passes a healthy run through", () => {
    const keys = [stepKey("CLICK", 1), stepKey("TYPE_TEXT", 2), stepKey("CLICK", 3)];
    assert.equal(detectStuck(keys, moving(3)), null);
  });

  it("flags the same action+target three times in a row", () => {
    const keys = frozen(REPEAT_LIMIT, stepKey("CLICK", 7));
    const stuck = detectStuck(keys, moving(REPEAT_LIMIT));
    assert.equal(stuck?.reason, "repeat");
    assert.match(stuck.note, /CLICK#7/);
    assert.match(stuck.note, /Refine the goal/);
  });

  it("does not flag two repeats — a retry is allowed", () => {
    const keys = frozen(REPEAT_LIMIT - 1, stepKey("CLICK", 7));
    assert.equal(detectStuck(keys, moving(keys.length)), null);
  });

  it("lets repeated scrolls run while the page keeps loading more", () => {
    const keys = frozen(REPEAT_LIMIT, stepKey("SCROLL_DOWN", null));
    assert.equal(detectStuck(keys, moving(REPEAT_LIMIT)), null);
  });

  it("flags repeated scrolls once the page stops changing", () => {
    const keys = frozen(REPEAT_LIMIT, stepKey("SCROLL_DOWN", null));
    const stuck = detectStuck(keys, frozen(REPEAT_LIMIT));
    assert.equal(stuck?.reason, "repeat");
  });

  it("flags SCROLL_DOWN/SCROLL_UP oscillation even while the page changes", () => {
    const keys = ["SCROLL_DOWN#none", "SCROLL_UP#none", "SCROLL_DOWN#none", "SCROLL_UP#none"];
    const stuck = detectStuck(keys, moving(4));
    assert.equal(stuck?.reason, "oscillation");
    assert.match(stuck.note, /oscillating/);
  });

  it("flags a frozen page even when the actions differ every step", () => {
    const keys = [
      stepKey("CLICK", 1),
      stepKey("CLICK", 2),
      stepKey("CLICK", 3),
      stepKey("CLICK", 4),
    ];
    const stuck = detectStuck(keys, frozen(NO_PROGRESS_LIMIT));
    assert.equal(stuck?.reason, "no-progress");
    assert.match(stuck.note, new RegExp(`${NO_PROGRESS_LIMIT} steps`));
  });

  it("clears once the page finally moves", () => {
    const keys = [
      stepKey("CLICK", 1),
      stepKey("CLICK", 2),
      stepKey("CLICK", 3),
      stepKey("CLICK", 4),
    ];
    assert.equal(detectStuck(keys, ["S", "S", "S", "moved"]), null);
  });
});

describe("createTypeTextSource", () => {
  it("hands the text to exactly one TYPE_TEXT step", () => {
    const src = createTypeTextSource("hello world");
    assert.equal(src.take(), "hello world");
    assert.equal(src.take(), undefined);
    assert.equal(src.remaining(), undefined);
  });

  it("trims and treats blank input as no text at all", () => {
    assert.equal(createTypeTextSource("  spaced  ").take(), "spaced");
    assert.equal(createTypeTextSource("   ").take(), undefined);
    assert.equal(createTypeTextSource(undefined).take(), undefined);
  });

  it("restores text when the act failed before it reached the page", () => {
    const src = createTypeTextSource("hello");
    const text = src.take();
    src.restore(text);
    assert.equal(src.take(), "hello");
    assert.equal(src.take(), undefined);
  });
});

describe("minConfidence", () => {
  it("defaults when unset", () => {
    assert.equal(minConfidence({}), DEFAULT_MIN_CONFIDENCE);
    assert.equal(minConfidence({ ASKJEV_MIN_CONFIDENCE: "  " }), DEFAULT_MIN_CONFIDENCE);
  });

  it("honours a valid override", () => {
    assert.equal(minConfidence({ ASKJEV_MIN_CONFIDENCE: "0.8" }), 0.8);
    assert.equal(minConfidence({ ASKJEV_MIN_CONFIDENCE: "0" }), 0);
  });

  it("ignores junk and out-of-range values rather than disabling the gate", () => {
    assert.equal(minConfidence({ ASKJEV_MIN_CONFIDENCE: "high" }), DEFAULT_MIN_CONFIDENCE);
    assert.equal(minConfidence({ ASKJEV_MIN_CONFIDENCE: "-1" }), DEFAULT_MIN_CONFIDENCE);
    assert.equal(minConfidence({ ASKJEV_MIN_CONFIDENCE: "12" }), DEFAULT_MIN_CONFIDENCE);
  });
});

describe("gateLowConfidence", () => {
  const gate = (over) =>
    gateLowConfidence({
      action: "CLICK",
      confidence: 0.2,
      minConfidence: DEFAULT_MIN_CONFIDENCE,
      probesUsed: 0,
      ...over,
    });

  it("proceeds when Jev is confident", () => {
    assert.equal(gate({ confidence: 0.9 }).kind, "proceed");
    assert.equal(gate({ confidence: DEFAULT_MIN_CONFIDENCE }).kind, "proceed");
  });

  it("never gates scroll/wait — they are the fallback", () => {
    for (const action of ["SCROLL_DOWN", "SCROLL_UP", "WAIT"]) {
      assert.equal(gate({ action }).kind, "proceed", action);
    }
  });

  it("probes instead of clicking blind on a low-confidence page change", () => {
    for (const action of ["CLICK", "TYPE_TEXT", "SELECT"]) {
      const r = gate({ action });
      assert.equal(r.kind, "probe", action);
      assert.match(r.note, /low confidence/);
    }
  });

  it("stops with an actionable note once the probes are spent", () => {
    const r = gate({ probesUsed: MAX_LOW_CONFIDENCE_PROBES });
    assert.equal(r.kind, "stop");
    assert.match(r.note, /ASKJEV_MIN_CONFIDENCE/);
    assert.match(r.note, /0\.20 < 0\.45/);
  });

  it("is independent of the irreversible threshold — a sure action still passes", () => {
    assert.equal(gate({ confidence: 0.64 }).kind, "proceed");
  });
});

describe("waitForRun", () => {
  it("returns true when the previous run finishes in time", async () => {
    assert.equal(await waitForRun(Promise.resolve("done"), 1000), true);
  });

  it("returns true for a rejected run without leaking the rejection", async () => {
    assert.equal(await waitForRun(Promise.reject(new Error("boom")), 1000), true);
  });

  it("returns false when the previous run is still going", async () => {
    const never = new Promise(() => {});
    assert.equal(await waitForRun(never, 20), false);
  });
});

describe("autopilot status", () => {
  it("reports a stopped run as stopped, not running", () => {
    const r = requestAutopilotStop();
    assert.equal(r.stopped, true);
    assert.equal(r.status, "stopped");
    const status = getAutopilotStatus();
    assert.equal(status.running, false);
    assert.equal(status.status, "stopped");
  });
});

describe("runJevAutopilot preconditions", () => {
  it("rejects an empty goal before touching the browser", async () => {
    await assert.rejects(() => runJevAutopilot({ goal: "   " }), /goal is required/);
  });

  it("fails loud without an API key — never silently scrolls", async (t) => {
    const saved = {
      ASKJEV_API_KEY: process.env.ASKJEV_API_KEY,
      TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
    };
    delete process.env.ASKJEV_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      if (resolveApiKey()) {
        // ~/.askjev/api-key exists on this machine — nothing to assert.
        t.skip("api key file present");
        return;
      }
      await assert.rejects(
        () => runJevAutopilot({ goal: "open example.com" }),
        (err) => {
          assert.equal(err.code, "missing_api_key");
          assert.match(err.message, /TypeSafe API key/);
          return true;
        },
      );
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
