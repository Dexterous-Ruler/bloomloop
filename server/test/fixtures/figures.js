// Figure specs used by the unit tests (test/figures.test.js), the render
// snapshots (test/snapshots/figures) and the end-to-end script
// (scripts/figures.mjs): one of each type, three of them stepped, and a small
// .pptx with pictures built in memory.

import AdmZip from 'adm-zip';
import crypto from 'node:crypto';

export const SPECS = {
  plot: {
    type: 'plot',
    title: 'A line and a parabola',
    x: { min: -5, max: 5, label: 'x' },
    y: { min: -6, max: 10, label: 'y' },
    functions: [
      { id: 'line', family: 'linear', params: { m: 2, c: 1 }, label: 'f' },
      { id: 'curve', family: 'quadratic', params: { a: 1, b: 0, c: -4 } },
      { id: 'steps', family: 'step', pieces: [{ from: -4, to: -2, y: -5, fromClosed: true }, { from: -2, to: 0, y: -3 }] },
    ],
    points: [{ id: 'A', x: 1, y: 3, label: 'A' }],
    segments: [{ id: 'v', from: [0, 0], to: [2, 4], arrow: true }],
    shade: [{ id: 'area', from: -1, to: 1, under: 'curve' }],
    steps: [
      { highlight: ['line'], caption: 'The line y = 2x + 1.' },
      { highlight: ['A', 'curve'], caption: 'Point A lies on the line, not the curve.' },
    ],
  },
  bar: {
    type: 'chart', chart: 'bar', title: 'Rainfall', y: { label: 'mm' },
    categories: ['June', 'July', 'August'], series: [{ name: '2024', values: [120, 300, 210] }, { name: '2025', values: [90, 340, 180] }],
  },
  line: { type: 'chart', chart: 'line', categories: ['Mon', 'Tue', 'Wed', 'Thu'], series: [{ name: 'Sales', values: [3, 5, 2, 7] }] },
  pie: { type: 'chart', chart: 'pie', slices: [{ label: 'Rent', value: 40 }, { label: 'Food', value: 35 }, { label: 'Other', value: 25 }] },
  histogram: { type: 'chart', chart: 'histogram', x: { label: 'Marks' }, bins: [{ from: 0, to: 10, count: 3 }, { from: 10, to: 20, count: 7 }, { from: 20, to: 30, count: 4 }] },
  dot: { type: 'chart', chart: 'dot', values: [1, 2, 2, 3, 3, 3, 4, 5] },
  box: { type: 'chart', chart: 'box', boxes: [{ label: 'Class A', min: 20, q1: 35, median: 48, q3: 60, max: 90 }] },
  numberline: {
    type: 'numberline', min: -5, max: 5, step: 1,
    points: [{ value: 2, label: 'a' }], intervals: [{ from: -3, to: 1, fromOpen: true }], rays: [{ from: 3, direction: 'right' }],
  },
  geometry: {
    type: 'geometry', view: { xMin: -1, xMax: 7, yMin: -1, yMax: 6 },
    points: [{ id: 'A', x: 0, y: 0, label: 'A' }, { id: 'B', x: 6, y: 0, label: 'B' }, { id: 'C', x: 2, y: 5, label: 'C' }],
    polygons: [{ id: 'tri', points: ['A', 'B', 'C'] }],
    angles: [{ id: 'atA', at: 'A', from: 'B', to: 'C', label: 'x' }],
    vectors: [{ id: 'W', from: 'C', dx: 0, dy: -2, label: 'W' }],
    steps: [{ highlight: ['atA'], caption: 'The angle at A.' }],
  },
  optics: { type: 'geometry', title: 'Convex lens', optics: { element: 'convex-lens', focal: 10, objectDistance: 25, objectHeight: 4 } },
  timeline: {
    type: 'timeline', title: 'Towards independence',
    events: [{ date: 1919, label: 'Jallianwala Bagh' }, { date: 1920, label: 'Non-cooperation begins' }, { date: 1930, label: 'Salt March' }, { date: '1947-08-15', label: 'Independence' }],
  },
  diagram: {
    type: 'diagram', layout: 'flowchart', title: 'Factorial',
    nodes: [
      { id: 'start', label: 'Start', shape: 'ellipse' },
      { id: 'test', label: 'Is n > 1?', shape: 'diamond' },
      { id: 'mul', label: 'n × fact(n - 1)' },
      { id: 'one', label: 'Return 1' },
    ],
    edges: [{ from: 'start', to: 'test' }, { id: 'yes', from: 'test', to: 'mul', label: 'yes' }, { id: 'no', from: 'test', to: 'one', label: 'no' }],
    steps: [{ highlight: ['test'], caption: 'Check the base case first.' }, { highlight: ['no', 'one'], caption: 'n is 1, so return 1.' }],
  },
  molecule: { type: 'molecule', smiles: 'CCO', name: 'Ethanol', formula: 'C2H6O' },
  pattern: { type: 'pattern', items: [{ shape: 'triangle' }, { shape: 'square', fill: 'outline' }, { shape: 'triangle', count: 2 }, { shape: 'square', fill: 'outline', count: 2 }, { blank: true }] },
  stack: {
    type: 'stack', title: 'fact(3)', frames: [{ id: 'main', label: 'main' }],
    steps: [
      { frames: [{ id: 'main', label: 'main' }, { id: 'f3', label: 'fact(3)', note: 'n = 3' }], caption: 'main calls fact(3).' },
      { frames: [{ id: 'main', label: 'main' }, { id: 'f3', label: 'fact(3)' }, { id: 'f2', label: 'fact(2)', note: 'n = 2' }], caption: 'fact(3) needs fact(2), so it waits.' },
      { frames: [{ id: 'main', label: 'main' }, { id: 'f3', label: 'fact(3)', note: 'returns 6' }], caption: 'fact(2) returns 2 and is popped.' },
    ],
  },
};

/** A Devanagari diagram: Hindi and Marathi labels. */
export const DEVANAGARI = {
  type: 'diagram', layout: 'mindmap',
  nodes: [{ id: 'root', label: 'प्रकाश संश्लेषण' }, { id: 'a', label: 'सूर्यप्रकाश' }, { id: 'b', label: 'पाणी आणि कार्बन डायऑक्साइड' }],
  edges: [{ from: 'root', to: 'a' }, { from: 'root', to: 'b' }],
};

// A real 1x1 PNG.
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** A PNG chunk: length, type, data, CRC (the CRC is not checked by the server, so zeros do). */
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
};

/** The PNG with a tEXt chunk naming its author, which an upload must take out. */
export const PNG_WITH_TEXT = Buffer.concat([PNG.subarray(0, 33), chunk('tEXt', Buffer.from('Author\0Dr Secret Person', 'latin1')), PNG.subarray(33)]);
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0', 'latin1'), Buffer.alloc(9), Buffer.from([0xff, 0xd9])]);
export const EMF = Buffer.concat([Buffer.from([1, 0, 0, 0]), crypto.randomBytes(80)]);
export const SVG_PICTURE = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
export const bigPng = (n) => Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(n, 7)]);

const REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

/**
 * A .pptx with pictures: `slides` is [{ n, text, media: [file names] }] where n is
 * the slide's own number in the file (gaps allowed); `files` maps a media file
 * name to its bytes.
 */
export function deckWithPictures(slides, files) {
  const zip = new AdmZip();
  for (const s of slides) {
    zip.addFile(`ppt/slides/slide${s.n}.xml`, Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
      + 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>'
      + `<a:p><a:r><a:t>${s.text}</a:t></a:r></a:p></p:spTree></p:cSld></p:sld>`, 'utf8'));
    const rels = s.media.map((m, i) => `<Relationship Id="rId${i + 2}" Type="${REL_IMAGE}" Target="../media/${m}"/>`).join('');
    zip.addFile(`ppt/slides/_rels/slide${s.n}.xml.rels`, Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${rels}`
      + `<Relationship Id="rId99" Type="${REL_IMAGE}" Target="https://example.invalid/far.png" TargetMode="External"/></Relationships>`, 'utf8'));
  }
  for (const [name, data] of Object.entries(files)) zip.addFile(`ppt/media/${name}`, data);
  return zip.toBuffer();
}
