/**
 * photos.js — turning a phone photo into something worth storing.
 *
 * A modern phone photo is four to eight megabytes. Ninety of them would be
 * half a gigabyte of IndexedDB, which is past the point where a browser starts
 * evicting storage — and evicting storage is how a training log disappears.
 * So every photo is decoded, rotated upright, resized and re-encoded before it
 * is stored, and a small thumbnail is stored beside it so a gallery of ninety
 * does not decode ninety full images.
 *
 * Three things this gets right that a naive implementation does not:
 *
 *   EXIF orientation. A photo taken in portrait on iOS is stored landscape
 *   with a rotation flag. Drawing it to a canvas without honouring that flag
 *   is how every check-in ends up on its side.
 *
 *   The quality search. One pass at a fixed quality either wastes space on an
 *   easy photo or blows the budget on a busy one, so the encoder steps down
 *   until it fits.
 *
 *   The original is never kept. There is no point storing eight megabytes of
 *   something you will look at on a phone screen.
 */

export const MAX_EDGE = 1280;
export const THUMB_EDGE = 320;
export const TARGET_BYTES = 260 * 1024;
export const MAX_INPUT_BYTES = 40 * 1024 * 1024;
const QUALITY_STEPS = [0.82, 0.72, 0.62, 0.52, 0.42];

/** The drawn size for a source, longest edge capped, aspect ratio kept. */
export function fitWithin(width, height, maxEdge) {
  if (!width || !height) return { width: 0, height: 0 };
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Bytes, in the units a person reads. */
export const formatBytes = (bytes) =>
  bytes == null ? '—' : bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

function canvasOf(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function encode(canvas, type, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('the browser could not encode the image'))), type, quality);
  });
}

async function drawTo(bitmap, maxEdge) {
  const size = fitWithin(bitmap.width, bitmap.height, maxEdge);
  const canvas = canvasOf(size.width, size.height);
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  return { canvas, size };
}

/** Encode at the highest quality that still fits the budget. */
async function encodeWithin(canvas, budget) {
  let last = null;
  for (const quality of QUALITY_STEPS) {
    last = await encode(canvas, 'image/jpeg', quality);
    if (last.size <= budget) return { blob: last, quality };
  }
  return { blob: last, quality: QUALITY_STEPS[QUALITY_STEPS.length - 1] };
}

/**
 * Read one picked file into the record shape the media store holds.
 *
 * Throws with a sentence a person can act on rather than a DOMException — a
 * HEIC that this browser cannot decode is a real and common case.
 */
export async function preparePhoto(file, { maxEdge = MAX_EDGE, targetBytes = TARGET_BYTES } = {}) {
  if (!file) throw new Error('No file was chosen.');
  if (!/^image\//.test(file.type || '')) {
    throw new Error(`${file.name || 'That file'} is not an image the app can read.`);
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error(`${file.name || 'That image'} is ${formatBytes(file.size)} — larger than the 40 MB limit.`);
  }

  let bitmap;
  try {
    // 'from-image' is what applies the EXIF rotation. Without it every portrait
    // photo from an iPhone is stored on its side.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(
      `This browser could not decode ${file.name || 'that image'}. iPhone HEIC photos often need to be shared as JPEG first.`
    );
  }

  try {
    const full = await drawTo(bitmap, maxEdge);
    const thumb = await drawTo(bitmap, THUMB_EDGE);
    const encoded = await encodeWithin(full.canvas, targetBytes);
    const thumbBlob = await encode(thumb.canvas, 'image/jpeg', 0.7);

    return {
      imageBytes: new Uint8Array(await encoded.blob.arrayBuffer()),
      imageType: 'image/jpeg',
      thumbBytes: new Uint8Array(await thumbBlob.arrayBuffer()),
      thumbType: 'image/jpeg',
      width: full.size.width,
      height: full.size.height,
      bytes: encoded.blob.size,
      originalBytes: file.size,
      originalName: file.name || null,
      quality: encoded.quality,
    };
  } finally {
    bitmap.close?.();
  }
}

/**
 * A blob URL for a stored image, cached per record.
 *
 * Every createObjectURL that is not revoked pins its bytes in memory for the
 * life of the page. Re-rendering a gallery of ninety photos on every keystroke
 * would do that ninety times a second.
 */
const urls = new Map();

export function imageUrl(id, bytes, type = 'image/jpeg') {
  if (!bytes) return null;
  const held = urls.get(id);
  if (held) return held.url;
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  urls.set(id, { url });
  return url;
}

export function releaseImageUrl(id) {
  const held = urls.get(id);
  if (!held) return;
  URL.revokeObjectURL(held.url);
  urls.delete(id);
}

export function releaseAllImageUrls() {
  for (const id of [...urls.keys()]) releaseImageUrl(id);
}
