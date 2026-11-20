/**
 * Exam mode's screen share and screen pictures, on a laptop (decision E5).
 *
 * Only what the browser offers a page: getDisplayMedia for the whole screen,
 * asked for on a press (no browser shows the picker without one), and one
 * small JPEG of it now and then, drawn from the shared track. Nothing here
 * runs on a phone: no phone browser can share its screen.
 */

/** Can this browser share its screen at all? Not on a phone, and not over plain http. */
export const canShare = () => typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';

/**
 * Ask for the whole screen. Resolves { stream, track, surface }, where
 * `surface` is what the browser says was shared ('monitor' for a whole
 * screen); rejects when the picker is closed or the browser says no.
 * A low frame rate: a picture is taken every half minute or so, and nothing
 * else reads the stream.
 */
export async function askScreen() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'monitor', frameRate: { ideal: 5 } },
    audio: false,
  });
  const track = stream.getVideoTracks()[0];
  if (!track) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('no video');
  }
  let surface = '';
  try { surface = track.getSettings?.().displaySurface ?? ''; } catch { /* an older browser: the server decides */ }
  return { stream, track, surface };
}

/** Stop sharing, quietly: every track of it. */
export function stopScreen(share) {
  try { share?.stream.getTracks().forEach((t) => t.stop()); } catch { /* already gone */ }
}

/**
 * A frame source for one share: ImageCapture where the browser has it (it
 * reads the track itself, page hidden or not), else a muted video element
 * that is never put on the page.
 */
export function frameSource(share) {
  let video = null;
  return {
    async frame() {
      if (share.track.readyState !== 'live') return null;
      if (typeof window.ImageCapture === 'function') {
        try { return await new window.ImageCapture(share.track).grabFrame(); } catch { /* fall back to the video */ }
      }
      if (!video) {
        video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.srcObject = share.stream;
        await video.play().catch(() => {});
        if (!video.videoWidth) await new Promise((r) => { video.onloadeddata = r; window.setTimeout(r, 1500); });
      }
      return video.videoWidth ? video : null;
    },
    close() {
      if (video) { video.srcObject = null; video = null; }
    },
  };
}

/**
 * One JPEG of a frame, at most `max` bytes and `width` pixels wide: drawn
 * smaller and plainer until it fits, a few times at most. A canvas's JPEG
 * carries no metadata. Resolves { bytes, width } or null.
 */
export async function jpegOf(img, width, max) {
  const w0 = img.videoWidth || img.width;
  const h0 = img.videoHeight || img.height;
  if (!w0 || !h0) return null;
  let w = Math.min(width, w0);
  let q = 0.6;
  for (let i = 0; i < 5; i += 1) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round((h0 * w) / w0));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    // eslint-disable-next-line no-await-in-loop
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
    // eslint-disable-next-line no-await-in-loop
    if (blob && blob.size <= max) return { bytes: await blob.arrayBuffer(), width: c.width };
    w *= 0.75;
    q = Math.max(0.35, q - 0.1);
  }
  return null;
}
