// Phase 2 - images and passages as question stimuli.
//
// The pure half (what an upload is, the url it is served at), the two rules that
// read the store (an image a question may show; an image a phone may load), the
// passage's citation, and the three repos' media methods. The end-to-end half,
// over HTTP and the socket, is server/scripts/media.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  sniffImage, looksLikeSvg, mediaUrl, mediaIdFromUrl, pointsAtMedia, withUpload, servedToPhones, IMAGE_TYPES, withoutMetadata,
} from '../src/services/media.js';
import { invalidReason, forStudent, MAX_STIMULUS_SOURCE } from '../src/questionTypes.js';
import { runChecks } from '../src/services/checks.js';
import { createMemoryRepo } from '../src/repo/memoryRepo.js';

// A real 1x1 PNG; the JPEG and WebP carry their signatures and nothing more,
// which is all sniffImage reads.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8L'), Buffer.alloc(8)]);
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const mcq = (over = {}) => ({
  text: 'Which pigment absorbs light in photosynthesis?',
  bloom: 'remember',
  kind: 'mcq',
  options: ['Chlorophyll.', 'Keratin.', 'Haemoglobin.', 'Collagen.'],
  answerIdx: 0,
  ...over,
});

describe('what an upload is: its bytes, not its name', () => {
  test('PNG, JPEG and WebP are told by their signatures', () => {
    assert.equal(sniffImage(PNG), 'image/png');
    assert.equal(sniffImage(JPEG), 'image/jpeg');
    assert.equal(sniffImage(WEBP), 'image/webp');
    assert.deepEqual(IMAGE_TYPES, ['image/png', 'image/jpeg', 'image/webp']);
  });

  test('everything else is nothing, SVG first among them', () => {
    assert.equal(sniffImage(SVG), null);
    assert.equal(looksLikeSvg(SVG), true);
    assert.equal(looksLikeSvg(Buffer.from('<svg width="1"></svg>')), true);
    assert.equal(sniffImage(Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1')), null);
    assert.equal(sniffImage(Buffer.from('<!doctype html><script>alert(1)</script>')), null);
    assert.equal(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')])), null, 'a RIFF that is not WebP');
    assert.equal(sniffImage(PNG.subarray(0, 7)), null, 'a PNG signature cut short');
    assert.equal(sniffImage(Buffer.alloc(0)), null);
    assert.equal(sniffImage('\x89PNG\r\n\x1a\n'), null, 'a string is not bytes');
    assert.equal(looksLikeSvg(PNG), false);
  });
});

describe('the url an upload is served at', () => {
  const id = '0123456789abcdef01234567';
  const uuid = '3f0b8f8e-6b0a-4c7e-9a51-1f2d3c4b5a69';

  test('is /api/media/<id>, and the id comes back out of it', () => {
    assert.equal(mediaUrl(id), `/api/media/${id}`);
    assert.equal(mediaIdFromUrl(mediaUrl(id)), id);
    assert.equal(mediaIdFromUrl(mediaUrl(uuid)), uuid);
  });

  test('any spelling Express would route counts as ours, and is read in lower case', () => {
    assert.equal(pointsAtMedia('/API/Media/X'), true);
    assert.equal(mediaIdFromUrl(` /API/MEDIA/${uuid.toUpperCase()} `), uuid);
  });

  test('anything but an id after the prefix is no id at all', () => {
    for (const url of [`/api/media/${id}?v=1`, `/api/media/${id}/x`, '/api/media/', '/api/media/../bank', `/api/media/${id}#x`]) {
      assert.equal(mediaIdFromUrl(url), null, url);
      assert.equal(pointsAtMedia(url), true, url);
    }
    assert.equal(pointsAtMedia('https://example.org/leaf.png'), false, 'an outside url is an outside url');
    assert.equal(pointsAtMedia('https://cdn.example.org/api/images/leaf.png'), false, 'even with /api/ in its path');
    assert.equal(pointsAtMedia('/u/leaf.png'), false);
    assert.equal(mediaIdFromUrl(null), null);
  });

  // A browser resolves dot segments, and an absolute url may name this very
  // server under any of its names (its own host, a custom domain, a tunnel),
  // which it cannot list. Each spelling below reaches GET /api/media/<id>.
  test('any spelling a browser resolves to /api/media/<id> is ours, on any host', () => {
    for (const url of [
      `/api/./media/${id}`, `/./api/media/${id}`, `/api/x/../media/${id}`, `/api//media/${id}`, `/api/%6Dedia/${id}`,
      `http://127.0.0.1:5050/api/media/${id}`, `https://bloomloop.example/API/MEDIA/${id}`, `//elsewhere.example/api/media/${id}`,
    ]) {
      assert.equal(pointsAtMedia(url), true, url);
      assert.equal(mediaIdFromUrl(url), id, url);
    }
  });

  test('a site-relative url anywhere else under /api/ is ours too, and is no image', () => {
    for (const url of ['/api/bank/x', '/API/session/ABC123', '/api/media/../bank']) {
      assert.equal(pointsAtMedia(url), true, url);
      assert.equal(mediaIdFromUrl(url), null, url);
    }
  });
});

/** A store with two chapters and one upload in the first. */
async function store() {
  const repo = createMemoryRepo();
  const a = await repo.createContent({ title: 'A', kind: 'syllabus', rawText: '', topics: ['T'], ownerId: null });
  const b = await repo.createContent({ title: 'B', kind: 'syllabus', rawText: '', topics: ['T'], ownerId: null });
  const media = await repo.createMedia({
    ownerId: null, contentId: a._id, mime: 'image/png', bytes: PNG.length, sha256: 'f'.repeat(64), data: PNG, alt: 'A leaf in cross-section',
  });
  return { repo, a, b, media };
}

describe('an image a question may show (withUpload)', () => {
  test('an upload of its own chapter, in canonical spelling, with the upload\'s alt when it has none', async () => {
    const { repo, a, media } = await store();
    const out = await withUpload(repo, { kind: 'image', url: `/API/Media/${media._id.toUpperCase()}` }, a._id);
    assert.deepEqual(out, { kind: 'image', url: `/api/media/${media._id}`, alt: 'A leaf in cross-section' });
    const own = await withUpload(repo, { kind: 'image', url: mediaUrl(media._id), alt: 'The stomata, labelled' }, a._id);
    assert.equal(own.alt, 'The stomata, labelled');
  });

  test('another chapter\'s upload, a missing one and a malformed one are the same 404', async () => {
    const { repo, b, media } = await store();
    const refusals = [];
    for (const url of [mediaUrl(media._id), mediaUrl('ffffffffffffffffffffffff'), '/api/media/not-an-id']) {
      await assert.rejects(withUpload(repo, { kind: 'image', url, alt: 'x' }, b._id), (err) => {
        refusals.push(`${err.status} ${err.message}`);
        return true;
      });
    }
    assert.deepEqual(refusals, Array(3).fill('404 That image was not found.'));
  });

  // Each of these used to be stored verbatim, carrying another chapter's upload.
  test('another chapter\'s upload under any other spelling is the same 404; one\'s own comes back canonical', async () => {
    const { repo, a, b, media } = await store();
    const spellings = (mid) => [
      `/api/./media/${mid}`, `/./api/media/${mid}`, `/api/x/../media/${mid}`, `http://127.0.0.1:5050/api/media/${mid}`, `/api/%6Dedia/${mid}`,
    ];
    for (const url of spellings(media._id)) {
      await assert.rejects(withUpload(repo, { kind: 'image', url, alt: 'x' }, b._id), (err) => err.status === 404, url);
      const own = await withUpload(repo, { kind: 'image', url, alt: 'x' }, a._id);
      assert.equal(own.url, mediaUrl(media._id), url);
    }
    await assert.rejects(withUpload(repo, { kind: 'image', url: '/api/media/../bank', alt: 'x' }, a._id), (err) => err.status === 404);
  });

  test('a passage, an outside image and null go through untouched', async () => {
    const { repo, a } = await store();
    const passage = { kind: 'passage', text: 'Read this.', sourceRef: 'NCERT XI, ch. 13' };
    const outside = { kind: 'image', url: 'https://example.org/leaf.png', alt: 'A leaf' };
    assert.equal(await withUpload(repo, passage, a._id), passage);
    assert.equal(await withUpload(repo, outside, a._id), outside);
    assert.equal(await withUpload(repo, null, a._id), null);
  });
});

describe('an image a phone may load (servedToPhones)', () => {
  const showing = (contentId, media, status = 'active') => ({
    ...mcq(), contentId, topic: 'T', status, stimulus: { kind: 'image', url: mediaUrl(media._id), alt: 'A leaf' },
  });

  test('only while a room runs on its chapter and an approved question there shows it', async () => {
    const { repo, a, b, media } = await store();
    assert.equal(await servedToPhones(repo, media), false, 'nothing at all');

    const [draft] = await repo.insertQuestions([showing(a._id, media, 'draft')]);
    const room = await repo.createSession({ code: 'MEDIA1', contentId: a._id, title: 'R', status: 'open' });
    assert.equal(await servedToPhones(repo, media), false, 'a room, but the image is only on a draft');

    await repo.insertQuestions([showing(b._id, media)]);
    await repo.createSession({ code: 'MEDIA2', contentId: b._id, title: 'R', status: 'open' });
    assert.equal(await servedToPhones(repo, media), false, 'shown by a question of another chapter');

    await repo.updateQuestion(draft._id, { status: 'active' });
    assert.equal(await servedToPhones(repo, media), true, 'approved, and the room is open');
    await repo.updateSession(room._id, { status: 'paused' });
    assert.equal(await servedToPhones(repo, media), true, 'paused: the phones are still in it');
    await repo.updateSession(room._id, { status: 'closed' });
    assert.equal(await servedToPhones(repo, media), false, 'closed');
  });

  test('a discarded question showing it does not count', async () => {
    const { repo, a, media } = await store();
    await repo.insertQuestions([showing(a._id, media, 'discarded')]);
    await repo.createSession({ code: 'MEDIA3', contentId: a._id, title: 'R', status: 'open' });
    assert.equal(await servedToPhones(repo, media), false);
  });
});

describe('a passage: its length and its citation', () => {
  const withPassage = (stimulus) => mcq({ stimulus: { kind: 'passage', text: 'Chlorophyll absorbs red and blue light.', ...stimulus } });

  test('may say where it came from, as text of at most 300 characters; blank means not given', () => {
    assert.equal(invalidReason(withPassage({ sourceRef: 'NCERT Biology XI, ch. 13' })), null);
    assert.equal(invalidReason(withPassage({ sourceRef: '' })), null);
    assert.equal(invalidReason(withPassage({ sourceRef: null })), null);
    assert.equal(invalidReason(withPassage({ sourceRef: 'x'.repeat(MAX_STIMULUS_SOURCE) })), null);
    assert.equal(invalidReason(withPassage({ sourceRef: 'x'.repeat(MAX_STIMULUS_SOURCE + 1) })), `stimulus sourceRef is over ${MAX_STIMULUS_SOURCE} characters`);
    assert.equal(invalidReason(withPassage({ sourceRef: { slides: [3] } })), 'stimulus sourceRef must be text saying where it came from');
    assert.equal(invalidReason(mcq({ stimulus: { kind: 'image', url: mediaUrl('0123456789abcdef01234567'), alt: 'A leaf', sourceRef: 'Fig. 13.2' } })), null);
  });

  test('is still capped at 4000 characters', () => {
    assert.equal(invalidReason(withPassage({ text: 'x'.repeat(4001) })), 'stimulus text is over 4000 characters');
  });

  test('the phone gets the text, never the citation; an upload reaches it as its url and alt', () => {
    const p = forStudent({ ...withPassage({ sourceRef: 'NCERT Biology XI, ch. 13' }), _id: 'q1' }, 'R1:q1');
    assert.deepEqual(p.stimulus, { kind: 'passage', text: 'Chlorophyll absorbs red and blue light.' });
    const url = mediaUrl('0123456789abcdef01234567');
    const i = forStudent({ ...mcq({ stimulus: { kind: 'image', url, alt: 'A leaf', sourceRef: 'Fig. 13.2' } }), _id: 'q2' }, 'R1:q2');
    assert.deepEqual(i.stimulus, { kind: 'image', url, alt: 'A leaf' });
  });
});

describe('slide-only-reference with an uploaded image', () => {
  const check = (q) => runChecks(q).find((c) => c.id === 'slide-only-reference');
  const image = { kind: 'image', url: mediaUrl('0123456789abcdef01234567'), alt: 'A leaf in cross-section' };

  test('a stem pointing at the picture passes once the upload is attached, and fails without it', () => {
    assert.equal(check(mcq({ text: 'Which layer does the diagram label X?' })).ok, false);
    assert.equal(check(mcq({ text: 'Which layer does the diagram label X?', stimulus: image })).ok, true);
    assert.equal(check(mcq({ text: 'In the figure shown above, which layer is X?', stimulus: image })).ok, true);
  });

  test('a passage clears "as shown above", and since 19 Nov 2026 a figure reference too', () => {
    const passage = { kind: 'passage', text: 'The palisade layer lies under the upper epidermis.' };
    assert.equal(check(mcq({ text: 'As shown above, which layer lies under the epidermis?', stimulus: passage })).ok, true);
    assert.equal(check(mcq({ text: 'Which layer does the diagram label X?', stimulus: passage })).ok, true);
  });
});

/* ------------------------------------------------- metadata in the bytes -- */

const latin = (s) => Buffer.from(s, 'latin1');
/** A JPEG marker segment: FF, the marker, a length that counts itself, the body. */
const seg = (marker, body) => {
  const b = Buffer.isBuffer(body) ? body : latin(body);
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(b.length + 2, 2);
  return Buffer.concat([head, b]);
};

/**
 * An Exif APP1 body as a camera writes it: IFD0 with the orientation, the
 * camera's make and a pointer to a GPS IFD holding the latitude.
 */
function exifBody({ orientation = 6, le = false } = {}) {
  const t = Buffer.alloc(110);
  const w16 = (o, v) => (le ? t.writeUInt16LE(v, o) : t.writeUInt16BE(v, o));
  const w32 = (o, v) => (le ? t.writeUInt32LE(v, o) : t.writeUInt32BE(v, o));
  t.write(le ? 'II' : 'MM', 0, 'latin1');
  w16(2, 42);
  w32(4, 8);
  w16(8, 3); // IFD0: three entries
  w16(10, 0x0112); w16(12, 3); w32(14, 1); w16(18, orientation); // Orientation, SHORT
  w16(22, 0x010f); w16(24, 2); w32(26, 10); w32(30, 50); // Make, ASCII at 50
  w16(34, 0x8825); w16(36, 4); w32(38, 1); w32(42, 60); // GPS IFD at 60
  t.write('SecretCam\0', 50, 'latin1');
  w16(60, 1); w16(62, 0x0001); w16(64, 2); w32(66, 2); t.write('N\0', 70, 'latin1'); // GPSLatitudeRef
  t.write('GPS 12.9716N 77.5946E', 78, 'latin1');
  return Buffer.concat([latin('Exif\0\0'), t]);
}

/** The APP1 the stripped file should carry: the orientation alone, little-endian. */
const orientationOnly = (v) => Buffer.from([
  0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // FF E1, length 34, "Exif\0\0"
  0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, //             II, 42, IFD0 at 8
  0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, // one entry: 0x0112, SHORT, 1
  v, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, //                the value; no next IFD
]);

// Everything a decoder needs, in order. Only their framing matters here.
const JFIF = seg(0xe0, latin('JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00'));
const ICC = seg(0xe2, latin('ICC_PROFILE\0\x01\x01fake profile bytes'));
const ADOBE = seg(0xee, latin('Adobe\0\x64\x00\x00\x00\x00\x01'));
const DQT = seg(0xdb, Buffer.alloc(65, 1));
const SOF = seg(0xc0, latin('\x08\x00\x01\x00\x01\x01\x01\x11\x00'));
const DHT = seg(0xc4, Buffer.alloc(20, 2));
// The scan: its header, then compressed data holding a stuffed FF 00, a restart
// marker and a fill byte, and the end of image.
const SCAN = Buffer.concat([seg(0xda, latin('\x01\x01\x00\x00\x3f\x00')), Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xff, 0xd9])]);

describe('what an upload keeps of its metadata (withoutMetadata)', () => {
  const SOI = Buffer.from([0xff, 0xd8]);
  const leaks = ['SecretCam', 'GPS', 'xmpmeta', 'MPF', 'Photoshop', 'Home Street', 'second image'];

  test('a JPEG loses its Exif, XMP, IPTC, comments, MPF and what follows the image, and keeps the picture and its orientation', () => {
    const photo = Buffer.concat([
      SOI, JFIF, seg(0xe1, exifBody()), seg(0xe1, 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>GPSLatitude 12.97</x:xmpmeta>'),
      ICC, seg(0xe2, 'MPF\0\x4d\x4d\x00\x2a'), seg(0xed, 'Photoshop 3.0\x008BIM author Dr Example'), seg(0xfe, 'shot at 12 Home Street'),
      ADOBE, DQT, SOF, DHT, SCAN, latin('a second image, with its own Exif and GPS'),
    ]);
    const out = withoutMetadata(photo, 'image/jpeg');
    assert.deepEqual(out, Buffer.concat([SOI, JFIF, orientationOnly(6), ICC, ADOBE, DQT, SOF, DHT, SCAN]));
    for (const s of leaks) assert.equal(out.includes(latin(s)), false, s);
  });

  test('the orientation is read in either byte order, and an upright one needs no Exif at all', () => {
    const tilted = Buffer.concat([SOI, seg(0xe1, exifBody({ orientation: 8, le: true })), DQT, SOF, DHT, SCAN]);
    assert.deepEqual(withoutMetadata(tilted, 'image/jpeg'), Buffer.concat([SOI, orientationOnly(8), DQT, SOF, DHT, SCAN]));
    const upright = Buffer.concat([SOI, seg(0xe1, exifBody({ orientation: 1 })), DQT, SOF, DHT, SCAN]);
    assert.deepEqual(withoutMetadata(upright, 'image/jpeg'), Buffer.concat([SOI, DQT, SOF, DHT, SCAN]));
  });

  test('a PNG loses its text, time and Exif chunks and what follows IEND; the rest is byte for byte', () => {
    const chunk = (type, data) => {
      const d = latin(data);
      const len = Buffer.alloc(4);
      len.writeUInt32BE(d.length);
      return Buffer.concat([len, latin(type), d, Buffer.alloc(4)]);
    };
    const IHDR = PNG.subarray(8, 33);
    const SRGB = chunk('sRGB', '\0');
    const tail = PNG.subarray(33);
    const photo = Buffer.concat([
      PNG.subarray(0, 8), IHDR, chunk('eXIf', exifBody().subarray(6).toString('latin1')), chunk('tEXt', 'Author\0Dr Example, Home Street'),
      chunk('zTXt', 'Comment\0\0xx'), chunk('iTXt', 'XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta>GPS</x:xmpmeta>'), chunk('tIME', '\x07\xea\x0b\x13\x0a\x00\x00'),
      SRGB, tail, latin('a second image'),
    ]);
    assert.equal(tail.toString('latin1', 4 + 4 + tail.readUInt32BE(0) + 4 + 4, 4 + 4 + tail.readUInt32BE(0) + 4 + 8), 'IEND', 'the fixture ends where it should');
    const out = withoutMetadata(photo, 'image/png');
    assert.deepEqual(out, Buffer.concat([PNG.subarray(0, 8), IHDR, SRGB, tail]));
    for (const s of leaks) assert.equal(out.includes(latin(s)), false, s);
  });

  test('a WebP loses its EXIF and XMP chunks, their flags and what follows the container', () => {
    const chunk = (type, data) => {
      const d = Buffer.isBuffer(data) ? data : latin(data);
      const head = Buffer.alloc(8);
      head.write(type, 0, 'latin1');
      head.writeUInt32LE(d.length, 4);
      return Buffer.concat([head, d, d.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
    };
    const riff = (...chunks) => {
      const body = Buffer.concat(chunks);
      const head = Buffer.alloc(12);
      head.write('RIFF', 0, 'latin1');
      head.writeUInt32LE(body.length + 4, 4);
      head.write('WEBP', 8, 'latin1');
      return Buffer.concat([head, body]);
    };
    // VP8X: ICC profile, alpha, EXIF and XMP flagged; a 1x1 canvas.
    const vp8x = (flags) => chunk('VP8X', Buffer.from([flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    const ICCP = chunk('ICCP', 'fake profile');
    const VP8L = chunk('VP8L', Buffer.from('2f0000100710111188880f', 'hex'));
    const photo = Buffer.concat([
      riff(vp8x(0x20 | 0x10 | 0x08 | 0x04), ICCP, VP8L, chunk('EXIF', exifBody().subarray(6)), chunk('XMP ', '<x:xmpmeta>GPS 12.97</x:xmpmeta>!')),
      latin('a second image'),
    ]);
    const out = withoutMetadata(photo, 'image/webp');
    assert.deepEqual(out, riff(vp8x(0x20 | 0x10), ICCP, VP8L));
    for (const s of leaks) assert.equal(out.includes(latin(s)), false, s);
  });

  test('a file with nothing to take out, or that cannot be walked, comes back as the same bytes', () => {
    const clean = Buffer.concat([SOI, JFIF, DQT, SOF, DHT, SCAN]);
    assert.equal(withoutMetadata(clean, 'image/jpeg'), clean);
    assert.equal(withoutMetadata(PNG, 'image/png'), PNG);
    for (const [buf, mime] of [[JPEG, 'image/jpeg'], [WEBP, 'image/webp'], [Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(40, 7)]), 'image/png']]) {
      assert.equal(withoutMetadata(buf, mime), buf, mime);
    }
    // Walked as far as it makes sense: what came before is cleaned, the rest kept as sent.
    const cut = Buffer.concat([SOI, seg(0xfe, 'shot at 12 Home Street'), DQT, Buffer.from([0xff, 0xc4, 0x7f, 0xff, 1, 2, 3])]);
    assert.deepEqual(withoutMetadata(cut, 'image/jpeg'), Buffer.concat([SOI, DQT, Buffer.from([0xff, 0xc4, 0x7f, 0xff, 1, 2, 3])]));
  });
});

describe('the repos\' media methods', () => {
  test('in-process: the row comes back without its bytes unless asked, and the bytes are a copy', async () => {
    const { repo, a, media } = await store();
    assert.match(media._id, /^[0-9a-f]{24}$/);
    assert.equal(media.data, undefined);
    assert.equal(media.contentId, a._id);
    assert.equal((await repo.getMedia(media._id)).data, undefined);
    const full = await repo.getMedia(media._id, { withData: true });
    assert.ok(full.data.equals(PNG));
    full.data[0] = 0;
    assert.ok((await repo.getMedia(media._id, { withData: true })).data.equals(PNG), 'changing a read copy changes nothing stored');
    assert.equal(await repo.getMedia('ffffffffffffffffffffffff'), null);
  });

  test('in-process: rooms by chapter, newest first, whatever their status', async () => {
    const { repo, a, b } = await store();
    await repo.createSession({ code: 'OLD001', contentId: a._id, status: 'closed', startedAt: '2026-11-01T00:00:00.000Z' });
    await repo.createSession({ code: 'NEW001', contentId: a._id, status: 'open', startedAt: '2026-11-19T00:00:00.000Z' });
    await repo.createSession({ code: 'OTHER1', contentId: b._id, status: 'open' });
    assert.deepEqual((await repo.listSessionsForContent(a._id)).map((s) => s.code), ['NEW001', 'OLD001']);
  });

  // Not a database test: no Supabase is reachable from here. This pins the
  // request the repo sends and how it reads the reply, bytea's text form included.
  test('Supabase: the bytes go as bytea text, and are only fetched when asked', async () => {
    const { config } = await import('../src/config.js');
    const { createSupabaseRepo } = await import('../src/repo/supabaseRepo.js');
    const saved = { ...config.supabase };
    const realFetch = globalThis.fetch;
    const seen = [];
    const id = '3f0b8f8e-6b0a-4c7e-9a51-1f2d3c4b5a69';
    const row = {
      id, owner_id: null, content_id: '11111111-1111-4111-8111-111111111111', mime: 'image/png', bytes: PNG.length,
      sha256: 'f'.repeat(64), alt: 'A leaf', created_at: '2026-11-19T10:00:00+00:00',
    };
    globalThis.fetch = async (url, init = {}) => {
      seen.push({ url: new URL(String(url)), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null });
      const withData = new URL(String(url)).searchParams.get('select')?.split(',').includes('data');
      const reply = withData ? { ...row, data: `\\x${PNG.toString('hex')}` } : row;
      // .single() on an insert reads one object; .maybeSingle() on a read, an array.
      const body = (init.method ?? 'GET') === 'GET' ? [reply] : reply;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    Object.assign(config.supabase, { url: 'http://supabase.invalid', serviceKey: 'test-key' });
    try {
      const repo = createSupabaseRepo();
      const made = await repo.createMedia({ ownerId: null, contentId: row.content_id, mime: 'image/png', bytes: PNG.length, sha256: row.sha256, data: PNG, alt: 'A leaf' });
      assert.equal(seen[0].method, 'POST');
      assert.equal(seen[0].url.pathname, '/rest/v1/media');
      assert.equal(seen[0].body.data, `\\x${PNG.toString('hex')}`);
      assert.equal(seen[0].url.searchParams.get('select'), 'id,owner_id,content_id,mime,bytes,sha256,alt,created_at');
      assert.deepEqual(made, { _id: id, ownerId: null, contentId: row.content_id, mime: 'image/png', bytes: PNG.length, sha256: row.sha256, alt: 'A leaf', createdAt: row.created_at });

      const meta = await repo.getMedia(id);
      assert.equal(seen[1].url.searchParams.get('select').includes('data'), false, 'a permission check fetches no bytes');
      assert.equal(seen[1].url.searchParams.get('id'), `eq.${id}`);
      assert.equal(meta.data, undefined);
      const full = await repo.getMedia(id, { withData: true });
      assert.ok(full.data.equals(PNG), 'bytea\'s text form decoded back to the bytes');

      assert.equal(await repo.getMedia('0123456789abcdef01234567'), null, 'a non-uuid id is not found, with no request');
      await repo.listSessionsForContent(row.content_id);
      assert.equal(seen[3].url.pathname, '/rest/v1/sessions');
      assert.equal(seen[3].url.searchParams.get('content_id'), `eq.${row.content_id}`);
      assert.equal(seen.length, 4);
    } finally {
      globalThis.fetch = realFetch;
      Object.assign(config.supabase, saved);
    }
  });

  // Not a database test either: the Mongo schema, checked by building documents.
  test('Mongo: ids are random, not a timestamp and a counter, and the schema holds the rules', async () => {
    const { Media } = await import('../src/models/index.js');
    const doc = (over = {}) => new Media({ contentId: 'c1', mime: 'image/png', bytes: 1, sha256: 'f'.repeat(64), data: Buffer.from([1]), alt: 'A leaf', ...over });
    const ids = Array.from({ length: 20 }, () => String(doc()._id));
    assert.equal(new Set(ids.map((i) => i.slice(0, 8))).size > 1, true, 'the first four bytes of a default ObjectId are the time');
    assert.equal(new Set(ids.map((i) => i.slice(8, 18))).size > 1, true, 'the next five are fixed per process');
    assert.equal(doc().validateSync(), undefined);
    assert.ok(doc({ mime: 'image/svg+xml' }).validateSync()?.errors?.mime);
    assert.ok(doc({ alt: undefined }).validateSync()?.errors?.alt);
    assert.ok(doc({ sha256: 'not-a-digest' }).validateSync()?.errors?.sha256);
    assert.ok(Buffer.from(doc({ data: PNG }).data).equals(PNG));
  });
});
