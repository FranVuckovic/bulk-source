/**
 * Back closes one sheet, and never leaves the app.
 *
 * The defect these prevent: closing one sheet and opening the next in the same
 * tap called `history.back()` and then `pushState()`. `back()` is
 * asynchronous, so it landed after the push and spent the NEW sheet's entry.
 * The next close then stepped back over a real screen: "Start" on the
 * "Rotation 7" sheet took the browser to `about:blank`, and Back after a
 * record celebration skipped the Log.
 *
 * The sheet-history code and the popstate handler are lifted out of app.js and
 * run against a model of Chrome's history, in which back() picks its target
 * entry when called and arrives there a task later.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

/** A browser history whose back() lands a task later, like Chrome's. */
function browserHistory() {
  const entries = [{ state: { view: { tab: 'outside' } }, outside: true }, { state: { view: { tab: 'train' } } }];
  let index = 1;
  let onPop = () => {};
  const history = {
    pushState(state) {
      entries.splice(index + 1);
      entries.push({ state });
      index++;
    },
    replaceState(state) {
      entries[index] = { state };
    },
    // Chrome picks the entry when back() is called and goes there a task
    // later, whatever was pushed in between. That is what turned "close one
    // sheet, open another" into a jump two entries back.
    back() {
      const target = index - 1;
      setTimeout(() => {
        index = target;
        onPop({ state: entries[index].state });
      }, 0);
    },
  };
  return {
    history,
    listen: (fn) => (onPop = fn),
    get current() {
      return entries[index];
    },
    get depth() {
      return index;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

/** The sheet functions and popstate handler from app.js, wired to fakes. */
function app() {
  const browser = browserHistory();
  const start = source.indexOf('let sheetEntry = false;');
  const end = source.indexOf('/*\n * Two things the on-screen keyboard breaks');
  assert.ok(start > -1 && end > start, 'app.js no longer has the sheet-history block');
  const popStart = source.indexOf('(event) => {', source.indexOf("addEventListener('popstate'"));
  const popEnd = source.indexOf('\n  });', popStart);
  const popHandler = source.slice(popStart, popEnd) + '\n  }';

  let open = false;
  const views = [];
  const hooks = {};
  const sheet = {
    open() {
      const was = open;
      open = true;
      if (!was) hooks.onOpen();
    },
    close({ fromBack = false } = {}) {
      const was = open;
      open = false;
      if (was) hooks.onClose({ fromBack });
    },
  };
  // eslint-disable-next-line no-new-func
  const built = new Function(
    'window', 'train', 'state', 'currentView', 'sheetIsOpen', 'closeSheet', 'render', 'applyView',
    `${source.slice(start, end)}
     return { onSheetOpen, onSheetClose, pop: ${popHandler} };`
  )(
    { history: browser.history, scrollTo() {} },
    { keepStepDraft() {} },
    {},
    () => ({ tab: 'train' }),
    () => open,
    (options) => sheet.close(options),
    () => {},
    (view) => views.push(view)
  );
  hooks.onOpen = built.onSheetOpen;
  hooks.onClose = built.onSheetClose;
  browser.listen(built.pop);
  return { browser, sheet, isOpen: () => open, views };
}

test('N5: a sheet replaced by another in one tap leaves one entry, and Back closes it', async () => {
  const { browser, sheet, isOpen } = app();
  sheet.open(); // "Start rotation 7 first"
  assert.equal(browser.depth, 2);

  // "Start rotation 7": close that sheet and open "Rotation 7" in the same tap.
  sheet.close();
  sheet.open();
  await settle();
  assert.equal(browser.depth, 2, 'the replacement pushed a second entry or spent its own');
  assert.equal(browser.current.state.sheet, true);

  // "Start" on "Rotation 7" closes it and gives the entry back.
  sheet.close();
  await settle();
  assert.equal(isOpen(), false);
  assert.equal(browser.depth, 1, 'closing the sheet did not land back on the screen under it');
  assert.equal(browser.current.outside, undefined, 'the app was left for about:blank');
});

test('N5: Back after a replaced sheet closes the sheet, not the screen under it', async () => {
  const { browser, sheet, isOpen, views } = app();
  sheet.open(); // the set editor
  sheet.close(); // saved: the editor closes …
  sheet.open(); // … and the record celebration opens
  await settle();

  // The Back gesture: the browser traverses, then the app hears popstate.
  browser.history.back();
  await settle();
  assert.equal(isOpen(), false, 'Back did not close the celebration');
  assert.equal(browser.depth, 1, 'Back skipped a level');
  assert.deepEqual(views, [], 'Back moved to another screen instead of closing the sheet');
});

test('N5: an ordinary tap close still gives its entry back exactly once', async () => {
  const { browser, sheet } = app();
  sheet.open();
  sheet.close();
  await settle();
  assert.equal(browser.depth, 1);
  sheet.open();
  sheet.close();
  await settle();
  assert.equal(browser.depth, 1, 'each open and close must leave the stack where it was');
});

test('N5: a sheet closed by navigating hands its entry to the new screen (wiring)', () => {
  const goTo = source.slice(source.indexOf('function goTo('), source.indexOf('function scrollToOpenTip('));
  assert.match(goTo, /keepClosingSheetEntry\(\)/, 'goTo pushes past a sheet entry that is still being given back');
});
