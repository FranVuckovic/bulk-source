import test from 'node:test';
import assert from 'node:assert/strict';

import { fitWithin, formatBytes, MAX_EDGE, THUMB_EDGE } from '../js/photos.js';

test('fitting caps the long edge and keeps the aspect ratio', () => {
  // A 4032×3024 phone photo, landscape.
  const landscape = fitWithin(4032, 3024, MAX_EDGE);
  assert.equal(landscape.width, MAX_EDGE);
  assert.equal(landscape.height, 960);
  assert.ok(Math.abs(landscape.width / landscape.height - 4032 / 3024) < 0.01);

  // The same photo in portrait caps on height, not width — which is the case
  // an implementation that only checks width gets wrong.
  const portrait = fitWithin(3024, 4032, MAX_EDGE);
  assert.equal(portrait.height, MAX_EDGE);
  assert.equal(portrait.width, 960);

  const thumb = fitWithin(3024, 4032, THUMB_EDGE);
  assert.equal(thumb.height, THUMB_EDGE);
});

test('an image already smaller than the cap is never enlarged', () => {
  assert.deepEqual(fitWithin(600, 400, MAX_EDGE), { width: 600, height: 400 });
});

test('a missing dimension produces nothing rather than NaN', () => {
  assert.deepEqual(fitWithin(0, 0, MAX_EDGE), { width: 0, height: 0 });
  assert.deepEqual(fitWithin(undefined, 100, MAX_EDGE), { width: 0, height: 0 });
});

test('byte sizes read the way a person reads them', () => {
  assert.equal(formatBytes(0), '0 KB', 'zero is a size, not a missing value');
  assert.equal(formatBytes(240 * 1024), '240 KB');
  assert.equal(formatBytes(4.2 * 1048576), '4.2 MB');
  assert.equal(formatBytes(null), '—');
});
