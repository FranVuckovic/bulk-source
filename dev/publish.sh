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

# Exactly the service worker's shell list, and nothing else.
#
# This used to copy whole directories — close enough to be believable, and
# wrong: data/ carried a retired plan file that nothing loads, named "Fran's
# Bulk Plan v1", published to the internet for no reason at all. The shell list
# is already the authoritative statement of what the app needs, and a test
# checks it against the module graph, so read it rather than restating it.
APP_FILES=$(node -e "
  const source = require('fs').readFileSync('sw.js', 'utf8');
  const start = source.indexOf('const SHELL = [');
  const block = source.slice(start, source.indexOf('];', start));
  const paths = [...block.matchAll(/'([^']+)'/g)]
    .map((m) => m[1].replace(/^\.\//, ''))
    .filter((p) => p && !p.endsWith('/'));
  console.log([...new Set(paths)].join('\n'));
")

[ -n "$APP_FILES" ] || { echo "could not read SHELL from sw.js" >&2; exit 1; }

# The worker itself is never in its own shell — it does not precache itself —
# so it has to be added back by hand. Leaving it out publishes an app that
# looks complete and has no offline mode and no update path.
APP_FILES="$APP_FILES sw.js"

rm -rf dist
for path in $APP_FILES; do
  [ -f "$path" ] || { echo "missing: $path" >&2; exit 1; }
  mkdir -p "dist/$(dirname "$path")"
  cp "$path" "dist/$path"
done

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

# HTTP/1.1 and a large buffer, set for this push only rather than in the user's
# global config. git over HTTP/2 fails on some networks with "RPC failed;
# HTTP 400 ... unexpected disconnect while reading sideband packet", and the
# push dies after uploading every object.
git -c http.version=HTTP/1.1 -c http.postBuffer=524288000 push -f origin main

echo
echo "Done. Now enable GitHub Pages: repo → Settings → Pages → Deploy from a branch → main → / (root)"
