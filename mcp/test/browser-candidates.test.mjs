import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SNAPSHOT_ELEMENT_LIMIT,
  browserCandidates,
  cdpPort,
  chooseProfile,
  isProfileLocked,
  ownProfileDir,
  realProfileDir,
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

describe("profile selection", () => {
  const brave = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

  it("maps the binary to that browser's real profile per platform", () => {
    assert.match(realProfileDir(brave, "darwin", {}), /BraveSoftware\/Brave-Browser$/);
    assert.match(realProfileDir(chrome, "darwin", {}), /Google\/Chrome$/);
    assert.match(
      realProfileDir(brave, "win32", { LOCALAPPDATA: "C:\\U\\AppData\\Local" }),
      /BraveSoftware.Brave-Browser.User Data$/,
    );
    assert.match(realProfileDir(brave, "linux", {}), /\.config\/BraveSoftware/);
  });

  it("returns null on Windows with no LOCALAPPDATA", () => {
    assert.equal(realProfileDir(brave, "win32", {}), null);
  });

  it("honours an explicit ASKJEV_PROFILE_DIR", () => {
    const c = chooseProfile(brave, { ASKJEV_PROFILE_DIR: "/tmp/p" }, "darwin");
    assert.equal(c.dir, "/tmp/p");
    assert.equal(c.isReal, false);
  });

  it("opts out to a separate profile with ASKJEV_OWN_PROFILE", () => {
    const c = chooseProfile(brave, { ASKJEV_OWN_PROFILE: "1" }, "darwin");
    assert.equal(c.dir, ownProfileDir());
    assert.equal(c.isReal, false);
  });

  it("falls back to its own profile when the real one does not exist", () => {
    // linux paths do not exist on the CI/mac box running this
    const c = chooseProfile(brave, {}, "linux");
    assert.equal(c.isReal, false);
    assert.equal(c.dir, ownProfileDir());
  });

  it("reports a profile as unlocked when there is no SingletonLock", () => {
    assert.equal(isProfileLocked("/tmp/definitely-not-a-profile-dir"), false);
  });
});
