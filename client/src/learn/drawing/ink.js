/**
 * The drawing kind's ink: how strokes are kept, painted and exported. No React.
 *
 * Everything is kept in the unit square (x, y and width as fractions of the
 * board's side), so the same strokes paint at any size: the phone's board at
 * its device pixels, and the exported picture at whatever size fits the cap.
 *
 * The list is a log: strokes, and `{ clear: true }` markers. Painting starts
 * after the last marker, so Clear is one more entry and Undo takes it back
 * like any stroke.
 */

/** Pen colours: each AA on the board's white paper, and none of them the
    right/wrong green or red. */
export const COLOURS = [
  { id: 'ink', name: 'Black', hex: '#1F2A24' },
  { id: 'green', name: 'Green', hex: '#2F6B4F' },
  { id: 'blue', name: 'Blue', hex: '#2A5A93' },
  { id: 'ochre', name: 'Ochre', hex: '#94600F' },
];

/** Stroke widths, as a fraction of the board's side (about 2, 4 and 9 px on a phone). */
export const WIDTHS = [
  { id: 'fine', name: 'Fine', w: 0.006 },
  { id: 'medium', name: 'Medium', w: 0.012 },
  { id: 'bold', name: 'Bold', w: 0.026 },
];

/** The upload's ceiling, in bytes (E4: size-capped). */
export const MAX_BYTES = 400 * 1000;

/** The entries in force: everything after the last Clear. */
export function shown(entries) {
  let from = 0;
  entries.forEach((e, i) => { if (e.clear) from = i + 1; });
  return entries.slice(from);
}

/** True when the board in force has a stroke of ink on it. */
export const hasInk = (entries) => shown(entries).some((e) => e.tool === 'pen');

/** One segment of a stroke, or a dot for its first point. */
export function segment(ctx, stroke, i, px) {
  const p = stroke.pts[i];
  ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  if (i === 0) {
    ctx.beginPath();
    ctx.arc(p[0] * px, p[1] * px, (p[2] * px) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const q = stroke.pts[i - 1];
  ctx.lineWidth = ((p[2] + q[2]) / 2) * px;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(q[0] * px, q[1] * px);
  ctx.lineTo(p[0] * px, p[1] * px);
  ctx.stroke();
}

/** Paints the board in force onto a cleared `px`-square context. */
export function paint(ctx, entries, px) {
  ctx.clearRect(0, 0, px, px);
  for (const s of shown(entries)) {
    for (let i = 0; i < s.pts.length; i += 1) segment(ctx, s, i, px);
  }
  ctx.globalCompositeOperation = 'source-over';
}

const blobOf = (canvas, type, quality) => new Promise((resolve) => {
  canvas.toBlob(resolve, type, quality);
});

/**
 * The board as a picture under `maxBytes`: WebP where the browser can write it
 * (lowering the quality first, then the size), PNG where it cannot (Safari's
 * toBlob answers PNG for WebP; then only the size goes down). Painted afresh
 * from the strokes on white, so a smaller picture is redrawn, not blurred, and
 * a canvas export carries no metadata. Null if nothing fits.
 */
export async function toPicture(entries, { maxBytes = MAX_BYTES, start = 1200 } = {}) {
  let px = start;
  for (let round = 0; round < 6 && px >= 240; round += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    paint(ctx, entries, px);
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, px, px);
    for (const quality of [0.85, 0.7, 0.55]) {
      const blob = await blobOf(canvas, 'image/webp', quality);
      if (!blob) break;
      if (blob.size <= maxBytes) return blob;
      if (blob.type !== 'image/webp') break;
    }
    px = Math.round(px * 0.75);
  }
  return null;
}

/**
 * The board as a data URL under the cap, or null: what an answer carries as
 * `image`. A string, so the phone's outbox keeps it on disk as it is and the
 * room's socket and the hub's route both take it.
 */
export async function toDataUrl(entries) {
  const blob = await toPicture(entries);
  if (!blob) return null;
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : null);
    r.onerror = () => resolve(null);
    r.readAsDataURL(blob);
  });
}
