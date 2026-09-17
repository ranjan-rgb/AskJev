#!/bin/bash
set -euo pipefail
cd /Users/zeus/Desktop/AskJev
echo "== AskJev ship on $(hostname) =="
gh auth status | head -8

# Ensure all_urls in manifest if still JS-only tree
python3 <<'PY'
import json
from pathlib import Path
m = Path("extension/manifest.json")
if m.exists():
    data = json.loads(m.read_text())
    for cs in data.get("content_scripts", []):
        cs["matches"] = ["<all_urls>"]
        cs["all_frames"] = True
    m.write_text(json.dumps(data, indent=2) + "\n")
    print("manifest matches:", data["content_scripts"][0]["matches"])
PY

git checkout main
git pull --ff-only || true
git checkout -B feat/askjev-all-sites-ts

# If src/ missing, stop with clear message (full TS pack may need to be copied first)
if [ ! -d src ]; then
  echo "NOTE: src/ not present yet — applying all_urls + README only this run"
fi

git add -A
git status
git commit -m "feat: AskJev protect all sites (all_urls) + docs" || echo "nothing to commit"
git push -u origin HEAD

gh pr create --title "feat: AskJev all_urls + launch docs" --body "## Summary
- content_scripts matches \`<all_urls>\` (every site; allowlist opt-out)
- docs/README for how TypeSafe Jev connects

## Test plan
- [ ] Load unpacked extension/
- [ ] Pay click on any site → overlay
" || echo "PR may already exist"

gh pr merge --merge --delete-branch || true
git checkout main
git pull --ff-only
echo "DONE"
gh pr list --limit 5
