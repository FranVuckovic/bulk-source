/**
 * ui/components.js — the pieces every screen shares.
 *
 * Units, formatting, the bottom sheet, the rest timer and the collapsible
 * section heading. No screen logic lives here.
 */

/* ═══════════════════════════════════════════════════════════════════════
   Units — display only
   ═══════════════════════════════════════════════════════════════════════ */

/*
 * Everything is stored in kilograms, always. Pounds is a rendering transform
 * applied on the way out and reversed on the way in, so switching units can
 * never round-trip a stored number into something slightly different.
 */
export const KG_PER_LB = 2.2046226218;

export const toDisplay = (kg, unit) => (unit === 'lb' ? kg * KG_PER_LB : kg);
export const fromDisplay = (value, unit) => (unit === 'lb' ? value / KG_PER_LB : value);

/** A load, formatted for display. Null renders as an em dash, never as 0. */
export const fmtLoad = (kg, unit) =>
  kg == null ? '—' : (Math.round(toDisplay(kg, unit) * 10) / 10).toFixed(1);

export const fmtNum = (value, digits = 1) =>
  value == null || Number.isNaN(value) ? '—' : Number(value).toFixed(digits);

/** The step the +/− buttons move by: plate size in kg, 5 lb in pounds. */
export const stepFor = (unit, increment) => (unit === 'lb' ? 5 : increment);

/**
 * Parse a number the way a person typed it. A number input renders 90.7 as
 * "90,7" under a comma-decimal locale, and plain parseFloat would read that as
 * 90 — losing 0.7 kg silently, every time, on a phone set to the wrong locale.
 */
export function parseNumber(value) {
  if (value == null) return null;
  const text = String(value).trim().replace(',', '.');
  if (text === '') return null;
  const parsed = parseFloat(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export const escape = (text) =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/* ═══════════════════════════════════════════════════════════════════════
   Bottom sheet
   ═══════════════════════════════════════════════════════════════════════ */

/*
 * Every sheet in the app opens and closes through these two functions, which
 * makes them the one place that can tell the router a sheet appeared. The
 * router uses that to put the sheet on the browser's history stack, so the
 * Android back gesture closes it instead of leaving the app.
 *
 * The hooks are registered rather than imported so this module stays ignorant
 * of routing — it draws a panel, and something else decides what back means.
 */
let hooks = {};

export function setSheetHooks(next) {
  hooks = next || {};
}

export function openSheet(html) {
  const wasOpen = sheetIsOpen();
  document.getElementById('pan').innerHTML = html;
  document.getElementById('sheet').classList.add('on');
  // Replacing the contents of an open sheet is not a new level to go back to.
  if (!wasOpen) hooks.onOpen?.();
}

export function closeSheet({ fromBack = false } = {}) {
  const wasOpen = sheetIsOpen();
  document.getElementById('sheet').classList.remove('on');
  document.getElementById('pan').innerHTML = '';
  if (wasOpen) hooks.onClose?.({ fromBack });
}

export const sheetIsOpen = () => document.getElementById('sheet').classList.contains('on');

/* ═══════════════════════════════════════════════════════════════════════
   Rest timer
   ═══════════════════════════════════════════════════════════════════════ */

/*
 * One bar, two jobs.
 *
 * `rest` counts down from the exercise's own rest interval and starts itself
 * when a set is ticked. `stopwatch` counts up and is driven by hand, for
 * everything the automatic one cannot know about — a warm-up, a hold, a rack
 * you are waiting for, a set someone else is using the bar for.
 *
 * They share the bar because two timers on screen at once would be two numbers
 * that disagree, and the answer to "how long has it been" has to be one number.
 */
/*
 * WALL-CLOCK, ALWAYS. Never count ticks.
 *
 * The first version did `restLeft -= 1` on a one-second setInterval, which is
 * only correct while the page is in the foreground on an unthrottled tab.
 * Background a phone browser and setInterval is throttled to about once a
 * minute, or suspended outright — so a three-minute rest with two minutes spent
 * on another app came back reading barely a minute gone. The clock was not
 * slow; it was measuring how often the browser felt like calling us.
 *
 * So nothing here accumulates. Every reading is derived from `Date.now()`
 * against an absolute instant fixed when the timer started, and the interval
 * exists only to repaint. Throttle it, suspend it, miss a thousand ticks: the
 * number is still right, because the number was never in the ticks.
 */
let paintHandle = null;
let mode = 'rest';
let running = false;

/**
 * closed → nothing on screen. bubble → a small draggable disc. full → the panel.
 *
 * Three states rather than two because the useful one during a set is neither:
 * a bar pinned across the bottom covers the exercise you are looking at, and a
 * closed timer is one you forget to start. The bubble sits out of the way,
 * shows the reading, and is one tap from the panel.
 */
let view = 'closed';

/**
 * Where the bubble sits: `x` as a fraction of the width, `up` as pixels above
 * the bottom edge.
 *
 * The vertical axis is pixels rather than a fraction on purpose. A phone's
 * viewport height is not a constant — it grows and shrinks as the address bar
 * hides and comes back — so anything stored as a fraction of it slides down the
 * screen when you scroll down and back up when you scroll up. Which is exactly
 * what "the timer scrolls with the page" was, on an element that never left
 * `position: fixed`. The bottom edge is the one that stays still, so the bubble
 * is measured from there.
 */
let bubbleAt = { x: 0.86, up: 300 };

/** Rest: the instant it finishes. Stopwatch: unused. */
let endsAtMs = null;
/** Stopwatch: when the current run began, and time banked from earlier runs. */
let startedAtMs = null;
let accumulatedMs = 0;
/**
 * The countdown length in use. Kept so Reset restarts the same rest rather than
 * guessing, and so +30s has something to add to when the clock has run out.
 */
let restSeconds = 180;
/** Whether a finished countdown has already announced itself. */
let announced = false;
/** Opt-in, off by default, remembered. */
let notify = false;

const STORE_KEY = 'bulk.timer';

function remember() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ bubbleAt, notify, restSeconds }));
  } catch {
    // A private window, or storage switched off. The timer still works; it just
    // starts in the default corner next time.
  }
}

function recall() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    if (saved.bubbleAt && Number.isFinite(saved.bubbleAt.x)) {
      const { x, up, y } = saved.bubbleAt;
      // Positions saved before the vertical axis became pixels are fractions.
      const height = window.visualViewport?.height ?? window.innerHeight ?? 800;
      bubbleAt = { x, up: Number.isFinite(up) ? up : clampUp(height * (1 - (y ?? 0.62)), height) };
    }
    if (typeof saved.notify === 'boolean') notify = saved.notify;
    if (Number.isFinite(saved.restSeconds)) restSeconds = saved.restSeconds;
  } catch {
    // Anything unreadable is treated as nothing saved.
  }
}

/**
 * The reading, from state and an instant. Pure, so the case that matters — a
 * long gap with no ticks delivered — can be tested by moving `nowMs`.
 */
export function timerReading(state, nowMs) {
  if (state.mode === 'rest') {
    const remainingMs = (state.endsAtMs ?? nowMs) - nowMs;
    return { seconds: Math.max(0, remainingMs / 1000), done: remainingMs <= 0 };
  }
  const elapsedMs = state.accumulatedMs + (state.running ? nowMs - state.startedAtMs : 0);
  return { seconds: Math.max(0, elapsedMs / 1000), done: false };
}

const snapshot = () => ({ mode, running, endsAtMs, startedAtMs, accumulatedMs });

const clock = (total) => {
  const value = Math.max(0, Math.round(total));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};

/**
 * Where the finish line moves to. Pure, because the interesting cases are all
 * about time that has already passed.
 *
 * A clock that has run out is at zero, not at minus two minutes, so +30s on it
 * gives thirty seconds — measured from now. And nothing can push the finish
 * line into the past: −30s on a clock with ten seconds left is zero, not −20.
 */
export function nextEndsAt(endsAtMs, nowMs, deltaSeconds) {
  const base = Math.max(nowMs, endsAtMs ?? nowMs);
  return Math.max(nowMs, base + deltaSeconds * 1000);
}

/**
 * Say that a countdown finished, once, and quietly.
 *
 * A notification only if it was asked for and granted; otherwise a short
 * vibration, which is what a phone in a pocket between sets can actually
 * convey. Neither is allowed to fire twice for the same countdown, and neither
 * dismisses the panel — that is the user's to do.
 */
function announce() {
  if (announced) return;
  announced = true;

  if (notify && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification('Rest is up', { body: 'Back to the bar.', tag: 'bulk-rest', silent: false });
    } catch {
      // Some browsers refuse a constructed Notification outside a service
      // worker. The vibration below still happens.
    }
  }
  try {
    navigator.vibrate?.([120, 80, 120]);
  } catch {
    // Not supported, or blocked. Nothing to fall back to, and nothing broken.
  }
}

function paintRest() {
  const bar = document.getElementById('rest');
  if (!bar) return;
  const reading = timerReading(snapshot(), Date.now());
  const text = clock(reading.seconds);

  const face = document.getElementById('rt');
  if (face) face.textContent = text;
  const bubbleFace = document.getElementById('rt-b');
  if (bubbleFace) bubbleFace.textContent = text;

  const label = document.getElementById('rl');
  if (label) label.textContent = mode === 'rest' ? 'Rest' : running ? 'Timer' : 'Timer — paused';

  const toggle = document.getElementById('rest-toggle');
  if (toggle) toggle.textContent = running ? 'Pause' : 'Start';

  bar.classList.toggle('on', view !== 'closed');
  bar.classList.toggle('big', view === 'full');
  bar.classList.toggle('stop', mode === 'stopwatch');

  /*
   * A countdown that never started has not finished. `timerReading` reports
   * done for a null `endsAtMs` — there is no time left because there was never
   * any — and reading that as "finished" made the app buzz on launch and paint
   * itself amber before anything had been opened.
   */
  const finished = mode === 'rest' && endsAtMs != null && reading.done;
  bar.classList.toggle('done', finished);
  const doneLine = document.getElementById('rdone');
  if (doneLine) doneLine.hidden = !finished;

  for (const button of bar.querySelectorAll('[data-act="rest-mode"]')) {
    button.classList.toggle('on', button.dataset.id === mode);
  }
  /*
   * Only the controls that mean something for the mode you are in. A preset
   * length and a ±30s nudge are countdown ideas; offering them while counting
   * up leaves a button that either does nothing or silently changes the mode
   * under you.
   */
  const countdownOnly = ['rpresets', 'radjust'];
  for (const id of countdownOnly) {
    const group = document.getElementById(id);
    if (group) group.hidden = mode !== 'rest';
  }

  const box = document.getElementById('rest-notify');
  if (box) box.checked = notify;

  placeBubble();

  if (finished && view !== 'closed') {
    // It has run out: stop repainting and stop counting, but stay on screen.
    // A timer that dismisses itself the moment you look up is no timer at all.
    if (running) {
      running = false;
      clearInterval(paintHandle);
      paintHandle = null;
    }
    announce();
  }
}

/**
 * Put the bubble where it was dragged to — on the glass, not in the document.
 *
 * A percentage on a `position: fixed` element resolves against the *layout*
 * viewport, and on a phone that grows and shrinks as the address bar hides and
 * comes back. So a bubble parked at 62% slid 45 pixels down when you scrolled
 * down and 45 back up when you scrolled up: the reported "the timer scrolls
 * with the page", from an element that never left `position: fixed`.
 *
 * The visual viewport is the part you can actually see. Resolving the stored
 * fraction against that, in pixels, and offsetting by however far it has been
 * pushed, pins the bubble to one spot on the screen through the address bar,
 * the on-screen keyboard and a pinch-zoom alike.
 */
/** Keep the bubble on screen whatever the viewport just did to itself. */
const clampUp = (up, height) => Math.min(Math.max(up, 96), Math.max(height - 40, 96));

function placeBubble() {
  const bubble = document.getElementById('rest-bubble');
  if (!bubble) return;
  const view = window.visualViewport;
  const width = view?.width ?? window.innerWidth;
  const height = view?.height ?? window.innerHeight;
  bubble.style.left = `${bubbleAt.x * width}px`;
  bubble.style.top = 'auto';
  bubble.style.bottom = `${clampUp(bubbleAt.up, height) - 33}px`;
}

const repaintEvery = (ms) => {
  clearInterval(paintHandle);
  paintHandle = setInterval(paintRest, ms);
};

/*
 * Coming back to the app repaints immediately rather than waiting up to a
 * second, so the first thing you see is the true number and not the stale one.
 */
if (typeof document !== 'undefined') {
  recall();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) paintRest();
  });
  window.addEventListener('pageshow', paintRest);
  window.addEventListener('focus', paintRest);

  // The visible viewport moves and resizes constantly on a phone. Every one of
  // those is a reason to re-place the bubble, and none of them is a scroll of
  // the document.
  const view = window.visualViewport;
  if (view) {
    view.addEventListener('resize', placeBubble);
    view.addEventListener('scroll', placeBubble);
  }
  window.addEventListener('orientationchange', placeBubble);
  window.addEventListener('resize', placeBubble);
}

/**
 * Dragging the bubble.
 *
 * Pointer events, so a finger and a mouse take the same path. A drag under a
 * few pixels is treated as a tap, or the bubble would be almost impossible to
 * open on a touchscreen. It is clamped inside the viewport with room for the
 * bottom navigation, so it can never be parked underneath it.
 */
export function wireTimerDrag() {
  const bubble = document.getElementById('rest-bubble');
  if (!bubble) return;

  let dragging = false;
  let moved = 0;
  let offsetX = 0;
  let offsetY = 0;

  bubble.addEventListener('pointerdown', (event) => {
    const box = bubble.getBoundingClientRect();
    offsetX = event.clientX - box.left - box.width / 2;
    offsetY = event.clientY - box.top - box.height / 2;
    dragging = true;
    moved = 0;
    bubble.setPointerCapture(event.pointerId);
  });

  bubble.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    moved += Math.abs(event.movementX) + Math.abs(event.movementY);
    if (moved < 4) return;
    bubble.classList.add('dragging');

    const margin = 34;
    const height = window.visualViewport?.height ?? window.innerHeight;
    const width = window.visualViewport?.width ?? window.innerWidth;
    const x = Math.min(Math.max(event.clientX - offsetX, margin), width - margin);
    const y = Math.min(Math.max(event.clientY - offsetY, margin), height - 96);
    bubbleAt = { x: x / width, up: clampUp(height - y, height) };
    placeBubble();
  });

  const release = (event) => {
    if (!dragging) return;
    dragging = false;
    bubble.classList.remove('dragging');
    bubble.releasePointerCapture?.(event.pointerId);
    if (moved >= 4) {
      remember();
      // A drag is not a tap. Swallow the click the browser is about to send.
      bubble.dataset.suppressClick = '1';
      setTimeout(() => delete bubble.dataset.suppressClick, 0);
    }
  };
  bubble.addEventListener('pointerup', release);
  bubble.addEventListener('pointercancel', release);
}

/** Rest comes from the exercise, not from a fixed three minutes. */
export function startRest(seconds) {
  mode = 'rest';
  running = true;
  announced = false;
  restSeconds = seconds;
  endsAtMs = Date.now() + seconds * 1000;
  if (view === 'closed') view = 'bubble';
  repaintEvery(250);
  paintRest();
  remember();
}

/**
 * Open the timer without logging a set.
 *
 * The rest timer used to exist only as a consequence of finishing a set. It is
 * also the thing you want between warm-up ramps, while waiting for a rack, and
 * on any set you did not log — so it opens on its own, in the same panel,
 * carrying the last rest length rather than a number picked out of the air.
 */
export function openTimerPanel() {
  view = 'full';
  if (mode === 'rest' && endsAtMs == null) {
    // Opened cold: show the length, ready, but do not start counting until
    // asked. A timer that starts itself when you only wanted to look at it is
    // worse than one that needs a tap.
    running = false;
    announced = false;
    endsAtMs = Date.now() + restSeconds * 1000;
    clearInterval(paintHandle);
    paintHandle = null;
  }
  paintRest();
}

/** Which of the three states the timer is in. */
export function setTimerView(next) {
  view = next;
  if (next === 'closed') {
    stopRest();
    return;
  }
  paintRest();
}

/** Fold the panel to the bubble, or open it out. The clock is untouched. */
export function expandTimer(on) {
  setTimerView(on ?? view !== 'full' ? 'full' : 'bubble');
}

/** Set a countdown of this many seconds, and start it. */
export function setCountdown(seconds) {
  mode = 'rest';
  restSeconds = seconds;
  running = true;
  announced = false;
  startedAtMs = null;
  accumulatedMs = 0;
  endsAtMs = Date.now() + seconds * 1000;
  if (view === 'closed') view = 'full';
  repaintEvery(250);
  paintRest();
  remember();
}

/** Move the finish line, without restarting. */
export function adjustRest(deltaSeconds) {
  if (mode !== 'rest') return;
  endsAtMs = nextEndsAt(endsAtMs, Date.now(), deltaSeconds);
  restSeconds = Math.max(15, restSeconds + deltaSeconds);
  announced = false;
  if (!running && endsAtMs > Date.now()) {
    running = true;
    repaintEvery(250);
  }
  paintRest();
  remember();
}

/** Countdown or count up, keeping the panel open either way. */
export function setTimerMode(next) {
  if (next === mode) return;
  if (next === 'stopwatch') {
    openStopwatch();
    view = 'full';
    paintRest();
    return;
  }
  setCountdown(restSeconds);
}

/** Whether a finished countdown should announce itself, and asking if so. */
export async function setNotify(on) {
  notify = !!on;
  remember();
  if (notify && typeof Notification !== 'undefined' && Notification.permission === 'default') {
    try {
      await Notification.requestPermission();
    } catch {
      // Refused, or unsupported. The vibration still happens.
    }
  }
  paintRest();
  return notify;
}

/** The hand-driven one. Opening it does not start it. */
export function openStopwatch() {
  mode = 'stopwatch';
  running = false;
  startedAtMs = null;
  accumulatedMs = 0;
  endsAtMs = null;
  announced = false;
  clearInterval(paintHandle);
  paintHandle = null;
  if (view === 'closed') view = 'full';
  paintRest();
}

export function toggleTimer() {
  if (mode === 'rest') {
    // Pause means pause. The remaining time is banked as the new length and the
    // clock stands still.
    if (running) {
      restSeconds = Math.max(0, ((endsAtMs ?? Date.now()) - Date.now()) / 1000);
      running = false;
      clearInterval(paintHandle);
      paintHandle = null;
    } else {
      endsAtMs = Date.now() + restSeconds * 1000;
      announced = false;
      running = true;
      repaintEvery(250);
    }
    paintRest();
    return;
  }
  if (running) {
    // Bank what this run was worth, so the total survives the pause.
    accumulatedMs += Date.now() - startedAtMs;
    startedAtMs = null;
    running = false;
    clearInterval(paintHandle);
    paintHandle = null;
  } else {
    startedAtMs = Date.now();
    running = true;
    repaintEvery(250);
  }
  paintRest();
}

export function resetTimer() {
  if (mode !== 'stopwatch') {
    setCountdown(restSeconds);
    return;
  }
  accumulatedMs = 0;
  startedAtMs = running ? Date.now() : null;
  paintRest();
}

export function stopRest() {
  clearInterval(paintHandle);
  paintHandle = null;
  running = false;
  mode = 'rest';
  endsAtMs = null;
  startedAtMs = null;
  accumulatedMs = 0;
  announced = false;
  view = 'closed';
  const bar = document.getElementById('rest');
  if (bar) bar.classList.remove('on', 'stop', 'big', 'done');
}

/** For tests: the timer's own state, without reaching into the module. */
export function timerState() {
  return { ...snapshot(), view, restSeconds, notify, bubbleAt };
}

/* ═══════════════════════════════════════════════════════════════════════
   Layout helpers
   ═══════════════════════════════════════════════════════════════════════ */

/** A heading that opens and closes the card under it. State survives renders. */
export function section(id, title, count, body, shut) {
  const isShut = shut.has(id);
  return `<h3 class="tap ${isShut ? 'shut' : ''}" data-act="section" data-id="${id}">${escape(title)}${
    count ? `<span class="n">${escape(count)}</span>` : ''
  }</h3>${isShut ? '' : body}`;
}

/**
 * The tabs across the top of a section.
 *
 * Every screen in this app had grown into one long column: Progress ran to
 * twenty headings, the Plan screen hid its exercises and workouts behind a list
 * you had to scroll to, and the only way to know what a section contained was
 * to travel through all of it. A section's parts belong at its top, where they
 * can be seen without reading.
 *
 * It is sticky under the header, so moving between parts never requires
 * scrolling back up first.
 */
export const subnav = (items, current, action, className = '') =>
  `<div class="subnav${className ? ` ${escape(className)}` : ''}">${items
    .map(
      ([id, label, count]) =>
        `<button class="pill ${id === current ? 'on' : ''}" data-act="${escape(action)}" data-id="${escape(id)}">${escape(
          label
        )}${count ? `<span class="n">${escape(count)}</span>` : ''}</button>`
    )
    .join('')}</div>`;

export const flag = (kind, icon, html) =>
  `<div class="flag f-${kind}"><i>${icon}</i><span>${html}</span></div>`;

/**
 * Where this data lives, said out loud.
 *
 * IndexedDB is scoped to an origin *inside one browser profile on one device*.
 * The phone and the laptop load the same address and get two entirely separate
 * databases; nothing syncs between them, and no code in this app could make it,
 * because there is no server to sync through.
 *
 * That is good news and bad news in the same sentence, and only the good half
 * is obvious. The good half: the two copies cannot collide or overwrite each
 * other. The bad half: log in both places and you quietly own two histories
 * that disagree, and neither one is wrong. This is worth saying before it
 * happens rather than after, which is why it appears wherever the question
 * naturally comes up rather than once in a settings page.
 */
export const deviceIsolationNote = () => `
  ${flag(
    'ok',
    '✓',
    `<b>This device has its own database, and it is the only copy.</b> Storage belongs to this browser on this
     device. Nothing syncs, because there is no server to sync through — so the app on your phone and the app in a
     desktop browser can never collide or overwrite one another.`
  )}
  ${flag(
    'warn',
    '!',
    `<b>They cannot share, either.</b> Log sessions in both places and you get <b>two separate histories that both
     look correct</b>, diverging from the day you started. Pick one device as the real log. A different browser on
     the same device counts as a different device, and a private window is a third one that is thrown away when it
     closes.`
  )}
  ${flag(
    'info',
    'i',
    `<b>The zip is the bridge.</b> Export from one, import into the other. That is the only way data moves between
     devices, and it replaces rather than merges — so move in one direction, deliberately.`
  )}`;

export const card = (inner, cls = '') => `<div class="card ${cls}">${inner}</div>`;
