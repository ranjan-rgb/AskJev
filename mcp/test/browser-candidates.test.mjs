import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SNAPSHOT_ELEMENT_LIMIT,
  browserCandidates,
  cdpPort,
} from "../dist/cdp-browser.js";

describe("browserCandidates", () => {
  it("emits real Windows paths, not double-escaped literals", () => {
    const win = browserCandidates("win32", {
      PROGRAMFILES: "C:\\Program Files",
      "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
      LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local",
    });
    for (const p of win) {
      assert.ok(
        !p.includes("\\\\"),
        `path must not contain a doubled backslash: ${p}`,
      );
    }
    assert.ok(
      win.includes(
        "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      ),
    );
    assert.ok(
      win.includes("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"),
    );
  });

  it("includes per-user Windows installs when LOCALAPPDATA is set", () => {
    const win = browserCandidates("win32", {
      LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local",
    });
    assert.ok(
      win.some((p) => p.startsWith("C:\\Users\\dev\\AppData\\Local")),
      "Chrome defaults to a per-user install on Windows",
    );
  });

  it("survives missing Windows env vars", () => {
    const win = browserCandidates("win32", {});
    assert.ok(win.length > 0);
    assert.ok(win.every((p) => p.startsWith("C:\\")));
  });

  it("prefers Brave on every platform", () => {
    for (const platform of ["darwin", "win32", "linux"]) {
      const list = browserCandidates(platform, {});
      const brave = list.findIndex((p) => /brave/i.test(p));
      const chrome = list.findIndex((p) => /chrome(?!.*brave)/i.test(p));
      assert.ok(brave >= 0, `${platform} should offer Brave`);
      assert.ok(
        chrome === -1 || brave < chrome,
        `${platform} must try Brave before Chrome`,
      );
    }
  });

  it("caps snapshots at a documented limit", () => {
    assert.equal(typeof SNAPSHOT_ELEMENT_LIMIT, "number");
    assert.ok(SNAPSHOT_ELEMENT_LIMIT > 0);
  });
});

describe("cdpPort", () => {
  it("reads the port from ASKJEV_CDP_URL", () => {
    assert.equal(cdpPort("http://127.0.0.1:9333"), 9333);
  });

  it("falls back to 9222 for a portless or junk url", () => {
    assert.equal(cdpPort("http://127.0.0.1"), 9222);
    assert.equal(cdpPort("not a url"), 9222);
    assert.equal(cdpPort(""), 9222);
  });
});
