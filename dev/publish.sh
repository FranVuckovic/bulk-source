#!/bin/sh
#
# Publish ONLY the app.
#
# Copies the files the app actually needs into dist/ and force-pushes that as
# its own repository. Everything else — docs/, test/, dev/, assets/, the git
# history of this project — stays on this machine.
#
# dist/ is a build artifact, not a history worth keeping, so each publish
# replaces it wholesale.
#
#   sh dev/publish.sh https://github.com/USERNAME/bulk.git
#
set -e

REMOTE="$1"
if [ -z "$REMOTE" ]; then
  echo "Usage: sh dev/publish.sh https://github.com/USERNAME/bulk.git" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Everything in the service worker's shell list, and nothing else.
APP_FILES="index.html manifest.webmanifest sw.js css js data icons"

for path in $APP_FILES; do
  [ -e "$path" ] || { echo "missing: $path" >&2; exit 1; }
done

rm -rf dist
mkdir -p dist
cp -R $APP_FILES dist/

cat > dist/README.md <<'EOF'
# Bulk

A single-user training app. Vanilla JavaScript, no dependencies, no network
calls, no accounts. All data stays in the browser it was logged in.

This repository holds the built app only. It is published so the app can be
installed to a phone home screen, which needs an https address.
EOF

cd dist
git init -q
git checkout -q -b main
git add -A
git -c user.email=noreply@localhost -c user.name=Bulk commit -qm "Bulk — app build $(date +%Y-%m-%d)"
git remote add origin "$REMOTE"

echo
echo "Publishing $(find . -type f -not -path './.git/*' | wc -l | tr -d ' ') files to $REMOTE"
git push -f origin main

echo
echo "Done. Now enable GitHub Pages: repo → Settings → Pages → Deploy from a branch → main → / (root)"
