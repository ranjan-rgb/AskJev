#!/usr/bin/env node
/** Pack extension/ → store/askjev-chrome-<version>.zip via Python ZIP_DEFLATED. */
import { execSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
mkdirSync(join(root, "store"), { recursive: true });
const out = join(root, "store", `askjev-chrome-${version}.zip`);

execSync("npm run build:extension", { cwd: root, stdio: "inherit" });

const pyPath = join(tmpdir(), `askjev-pack-chrome-${process.pid}.py`);
writeFileSync(
  pyPath,
  `
import zipfile
from pathlib import Path
root = Path(${JSON.stringify(root)})
ext = root / "extension"
out = Path(${JSON.stringify(out)})
skip = {".DS_Store", ".git"}
count = 0
with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as z:
    for p in sorted(ext.rglob("*")):
        if not p.is_file():
            continue
        if p.name in skip or p.suffix == ".map":
            continue
        z.write(p, p.relative_to(ext).as_posix())
        count += 1
print(f"wrote {out} ({count} files)")
`,
);
try {
  execSync(`python3 ${JSON.stringify(pyPath)}`, { cwd: root, stdio: "inherit" });
} finally {
  try {
    unlinkSync(pyPath);
  } catch {
    /* ignore */
  }
}
console.error("pack-chrome:", out);
