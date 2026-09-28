#!/bin/zsh
# Pull WHOOP, rebuild the page and the encrypted health data, and publish.
# Safe to run any time; commits only when something actually changed.
set -euo pipefail
cd "$(dirname "$0")/.."

python3 tools/whoop_pull.py
python3 tools/build_site.py

git add docs
if git diff --cached --quiet; then
  echo "değişiklik yok"
  exit 0
fi
git commit -q -m "Refresh WHOOP data ($(date +%Y-%m-%d))"
git push -q origin main
echo "yayınlandı"
