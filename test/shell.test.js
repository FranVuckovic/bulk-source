/**
 * The offline shell has to hold the whole module graph.
 *
 * A file that is imported but not precached works perfectly in development,
 * works on the first online load, and then fails the first time the app is
 * opened in a gym with no signal — which is the one time it matters. This is
 * exactly what happened to `photos.js`: added after the shell list was
 * written, and invisible until this test existed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), 'utf8');

/** Every path listed in the service worker's SHELL array. */
function shellPaths() {
  const source = read('sw.js');
  const block = source.slice(source.indexOf('const SHELL = ['), source.indexOf('];', source.indexOf('const SHELL = [')));
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1].replace(/^\.\//, ''));
}

/** Walk the import graph from index.html's entry point. */
function moduleGraph() {
  const entry = 'js/app.js';
  const seen = new Set();
  const queue = [entry];

  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);

    for (const match of read(file).matchAll(/from\s+'(\.[^']+)'/g)) {
      queue.push(normalize(join(dirname(file), match[1])));
    }
  }
  return seen;
}

test('every module the app imports is in the offline shell', () => {
  const shell = new Set(shellPaths());
  const missing = [...moduleGraph()].filter((file) => !shell.has(file));
  assert.deepEqual(missing, [], `not precached: ${missing.join(', ')}`);
});

test('the shell lists nothing that does not exist', () => {
  const missing = shellPaths().filter((path) => {
    if (path === '' || path.endsWith('/')) return false;
    try {
      readFileSync(join(root, path));
      return false;
    } catch {
      return true;
    }
  });
  assert.deepEqual(missing, [], `listed but absent: ${missing.join(', ')}`);
});

test('the shell holds the plan the app actually loads, and not the one it does not', () => {
  const shell = new Set(shellPaths());
  const planUrl = read('js/app.js').match(/PLAN_URL\s*=\s*'\.\/([^']+)'/)?.[1];
  assert.ok(planUrl, 'app.js still names a plan file');
  assert.ok(shell.has(planUrl), `${planUrl} is loaded at startup but not precached`);
});

test('every js file in the project is reachable from the entry point', () => {
  // A module nothing imports is either dead or a missing wire-up. Either way
  // it should be noticed rather than shipped.
  const graph = moduleGraph();
  const files = [];
  for (const dir of ['js', 'js/ui']) {
    for (const name of readdirSync(join(root, dir))) {
      if (name.endsWith('.js')) files.push(relative(root, join(root, dir, name)));
    }
  }
  const orphans = files.filter((file) => !graph.has(file));
  assert.deepEqual(orphans, [], `imported by nothing: ${orphans.join(', ')}`);
});


test('the app opens sessions only through the atomic path', () => {
  // The guarantee is only worth as much as the call site. `startSessionAtomic`
  // was written, tested and then not used: `ensureActiveLog` wrote the log and
  // the active pointer separately, so five taps in one turn of the event loop
  // opened five sessions for the same slot.
  const app = read('js/app.js');
  const starter = app.slice(app.indexOf('async function ensureActiveLog'), app.indexOf('async function saveSet'));

  assert.ok(starter.includes('startSessionAtomic('), 'ensureActiveLog must go through startSessionAtomic');
  assert.ok(starter.includes('operationId'), 'and must pass a stable operation id');
  assert.ok(!starter.includes('saveSession('), 'a plain saveSession here bypasses the active-pointer check');
});

test('deletion in the app is recoverable, not a raw remove', () => {
  const app = read('js/app.js');
  const deleter = app.slice(app.indexOf('async deleteEntry('), app.indexOf('async emptyBin('));
  assert.ok(deleter.includes('softDeleteSession('), 'sessions are soft-deleted');
  assert.ok(deleter.includes('softDeleteRow('), 'so is everything else');
  assert.ok(!deleter.includes('deleteSessionCascade('), 'the cascade belongs to emptying the bin only');
});

test('an active session can be discarded only through the recoverable deletion path', () => {
  const app = read('js/app.js');
  const action = app.slice(app.indexOf("async 'confirm-discard-session'"), app.indexOf("'rest-skip'"));

  assert.ok(action.includes("ctx.deleteEntry('session'"), 'discard uses the central soft-delete path');
  assert.ok(action.includes("reason: 'discarded while active'"), 'the recovery audit says why it moved');
  assert.ok(!action.includes('deleteSessionCascade('), 'discard never destroys a session directly');
});

test('the session clock control is above the exercise list', () => {
  const train = read('js/ui/train.js');
  const view = train.slice(train.indexOf('export function view'), train.indexOf('function timingRow'));

  assert.ok(view.indexOf('data-act="start-session"') < view.indexOf('exerciseBlock(state'));
  assert.ok(view.includes('data-act="discard-session"'), 'an active session exposes the recoverable escape hatch');
});

test('the set editor exposes and saves an explicit index-set choice', () => {
  const train = read('js/ui/train.js');
  const app = read('js/app.js');

  assert.ok(train.includes('data-flag="isIndexSet"'), 'the set sheet has a visible index-set toggle');
  assert.ok(train.includes('isIndexSet: values.logged ? !!values.logged.isIndexSet : !!slot.idx'));
  assert.ok(train.includes('isIndexSet: c.isIndexSet'), 'the choice reaches saveSet');
  assert.ok(app.includes('values.isIndexSet == null ? !!slot.idx : !!values.isIndexSet'));
});

test('exercise actions are grouped by consequence instead of rendered as one button list', () => {
  const train = read('js/ui/train.js');
  const block = train.slice(train.indexOf('function exerciseBlock'), train.indexOf('function prescriptionHint'));

  for (const label of ['Values', 'Setup', 'Exercise']) assert.ok(block.includes(`actionGroup('${label}'`));
  assert.ok(block.includes('class="ex-actions"'));
  assert.ok(block.includes("prescribed != null\n      ? `<button class=\"warn\" data-act=\"clear-pres\""));
});

test('custom workouts are explicitly outside plan rotation progress', () => {
  const app = read('js/app.js');
  const train = read('js/ui/train.js');

  assert.ok(train.includes("export const CUSTOM_SESSION_ID = 'custom'"));
  assert.ok(train.includes('does not advance or change the A–F rotation'));
  assert.ok(app.includes('plannedFinished = finished.filter'));
  assert.ok(app.includes('rotationPosition: state.trainSessionId === train.CUSTOM_SESSION_ID ? null'));
});

test('every icon the manifest names is precached and present', () => {
  // An icon whose bytes change but whose filename does not is an icon the
  // installed app will never notice. The filenames carry the version, so the
  // manifest has to keep up with them and so does the shell.
  const manifest = JSON.parse(read('manifest.webmanifest'));
  const shell = new Set(shellPaths());

  for (const icon of manifest.icons) {
    const path = icon.src.replace(/^\.\//, '');
    assert.ok(shell.has(path), `${path} is in the manifest but not precached`);
    assert.doesNotThrow(() => readFileSync(join(root, path)), `${path} is named but missing`);
  }

  assert.ok(
    manifest.icons.some((icon) => icon.purpose === 'maskable'),
    'Android crops a non-maskable icon into whatever shape the launcher uses'
  );
});

test('the page and the manifest agree about which icon files exist', () => {
  const html = read('index.html');
  for (const match of html.matchAll(/href="\.\/(icons\/[^"]+)"/g)) {
    assert.doesNotThrow(() => readFileSync(join(root, match[1])), `${match[1]} is linked from index.html but missing`);
  }
});

test('the publish script derives its file list from the shell, not from directories', () => {
  // Copying whole directories was close enough to be believable and wrong:
  // data/ carried a retired plan file that nothing loads and that had a name
  // in it, published to a public repository for no reason.
  const publish = read('dev/publish.sh');

  assert.ok(publish.includes("readFileSync('sw.js'"), 'publish.sh reads the shell list from sw.js');
  assert.ok(!/cp -R \$APP_FILES/.test(publish), 'and no longer copies directories wholesale');

  // Anything in data/ that the shell does not name must stay unpublished.
  const shell = new Set(shellPaths());
  const retired = readdirSync(join(root, 'data'))
    .map((name) => `data/${name}`)
    .filter((path) => !shell.has(path));

  for (const path of retired) {
    assert.ok(!shell.has(path), `${path} is not in the shell, so publish must not copy it`);
  }
});

test('nothing the app publishes carries a personal identifier', () => {
  // The published build goes to a public repository under a real name. The
  // plan the app loads is training content and belongs there; a retired plan
  // titled after its owner does not.
  for (const path of shellPaths()) {
    if (!/\.(json|js|html|css|webmanifest|md)$/.test(path)) continue;
    const text = readFileSync(join(root, path), 'utf8');
    assert.doesNotMatch(text, /Fran|Vuckovic|fran-bulk/i, `${path} is published and names its owner`);
  }
});


test('the published build includes the service worker itself', () => {
  // A worker never appears in its own precache list, so deriving the publish
  // set from SHELL drops it — and an app with no sw.js looks completely normal
  // right up until it needs to work offline or take an update.
  const publish = read('dev/publish.sh');
  const shell = new Set(shellPaths());

  assert.ok(!shell.has('sw.js'), 'the worker is not expected to precache itself');
  assert.match(publish, /APP_FILES="\$APP_FILES sw\.js"/, 'so publish.sh has to add it back explicitly');
});

test('the published build includes everything index.html asks for', () => {
  // index.html is the entry point; anything it references by src or href has
  // to be in the build or the app is broken on arrival.
  const html = read('index.html');
  const shell = new Set([...shellPaths(), 'sw.js']);

  const referenced = [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map((m) => m[1]);
  for (const path of referenced) {
    assert.ok(shell.has(path), `index.html references ${path}, which is not published`);
  }
});

test('the demo warning is hidden unless demo mode is actually on', () => {
  // The author stylesheet sets `.demostrip { display:flex }`, which overrides
  // the browser's built-in `[hidden] { display:none }` rule. Without an author
  // rule of our own the warning appears on real data even though both the HTML
  // and app state correctly set the hidden property.
  const html = read('index.html');
  const css = read('css/app.css');
  const app = read('js/app.js');

  assert.match(html, /id="demostrip"[^>]*\bhidden\b/, 'the strip starts hidden before JavaScript runs');
  assert.match(css, /\.demostrip\[hidden\]\s*\{\s*display\s*:\s*none\s*\}/, 'author CSS must honour hidden');
  assert.match(app, /getElementById\('demostrip'\)\.hidden\s*=\s*!state\.demo/, 'render follows demo state');
});

test('demo data is the first Settings section instead of a buried utility', () => {
  const settings = read('js/ui/settings.js');
  const demo = settings.indexOf('>Demo data</h3>');
  const training = settings.indexOf('Training &amp; display');
  const danger = settings.indexOf('Deletion &amp; reset');

  assert.ok(demo > 0 && demo < training && demo < danger);
  assert.match(settings, /data-act="demo-on">Explore the demo/);
  assert.match(settings, /<details class="card settings-group" open>/, 'only everyday settings start open');
  assert.match(settings, /<details class="card settings-group danger-settings">/, 'destructive settings start collapsed');
});
