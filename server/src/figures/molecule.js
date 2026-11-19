// Molecules from SMILES, drawn by RDKit and checked by it.
//
// RDKit refuses a SMILES string that is not a real molecule, and it works the
// molecular formula out from the structure, so a formula someone stated (a
// model, or a professor typing quickly) can be checked against the drawing
// rather than trusted. RDKit's own SVG is not passed on as it comes: it is read
// path by path, and only the paths, their geometry and their colours are kept,
// grouped by atom and bond with the figure's ids.

import { px, partAttrs } from './common.js';

const SYMBOLS = ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr '
  + 'Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re '
  + 'Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh '
  + 'Fl Mc Lv Ts Og').split(' ');
export const symbolOf = (z) => (z === 0 ? '*' : SYMBOLS[z - 1] ?? '?');

/** Element counts as a Hill formula: C, then H, then the rest alphabetically (all alphabetical without carbon). */
export function hill(counts, charge = 0) {
  const els = Object.keys(counts).filter((e) => counts[e] > 0);
  const order = counts.C ? ['C', ...(counts.H ? ['H'] : []), ...els.filter((e) => e !== 'C' && e !== 'H').sort()] : els.sort();
  const body = order.map((e) => `${e}${counts[e] === 1 ? '' : counts[e]}`).join('');
  if (!charge) return body;
  return `${body}${Math.abs(charge) === 1 ? '' : Math.abs(charge)}${charge > 0 ? '+' : '-'}`;
}

/** Element counts from a typed formula, condensed ones too (C2H5OH counts as C2H6O). */
export function countsOf(formula) {
  const counts = {};
  const body = String(formula).replace(/\d*[+-]$/, '');
  for (const m of body.matchAll(/([A-Z][a-z]?)(\d*)/g)) counts[m[1]] = (counts[m[1]] ?? 0) + (m[2] ? Number(m[2]) : 1);
  return counts;
}

const sameCounts = (a, b) => {
  const ks = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of ks) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
};

/** Atoms from RDKit's JSON: symbol, implicit hydrogens and charge per atom. */
function atomsOf(mol) {
  const json = JSON.parse(mol.get_json());
  const d = json.defaults?.atom ?? {};
  const m = json.molecules?.[0] ?? { atoms: [] };
  return (m.atoms ?? []).map((a) => {
    const z = a.z ?? d.z ?? 6;
    return { z, symbol: symbolOf(z), h: a.impHs ?? d.impHs ?? 0, charge: a.chg ?? d.chg ?? 0 };
  });
}

const PATH_D = /^[MLQCAZmlqcaz0-9.,\s\-eE]+$/;
const COLOUR = /^#[0-9A-Fa-f]{6}$/;

/** RDKit's SVG, rebuilt from its paths and nothing else. */
function rebuild(svg, prefix) {
  const groups = new Map();
  for (const tag of svg.matchAll(/<path\s([^>]*?)\/?>/g)) {
    const attr = (name) => new RegExp(`${name}='([^']*)'`).exec(tag[1])?.[1] ?? new RegExp(`${name}="([^"]*)"`).exec(tag[1])?.[1] ?? null;
    const cls = attr('class') ?? '';
    const d = attr('d') ?? '';
    if (!PATH_D.test(d)) continue;
    const style = attr('style') ?? '';
    const prop = (name) => new RegExp(`${name}:([^;]+)`).exec(style)?.[1]?.trim() ?? null;
    const fill = attr('fill') ?? prop('fill') ?? 'none';
    const stroke = prop('stroke') ?? 'none';
    const width = Number.parseFloat(prop('stroke-width') ?? '0');
    const paint = [
      `fill="${COLOUR.test(fill) ? fill : 'none'}"`,
      `stroke="${COLOUR.test(stroke) ? stroke : 'none'}"`,
      ...(Number.isFinite(width) && width > 0 ? [`stroke-width="${px(Math.min(width, 6))}"`, 'stroke-linecap="round"'] : []),
    ].join(' ');
    const bond = /\bbond-(\d+)\b/.exec(cls);
    const atom = /^atom-(\d+)$/.exec(cls.trim());
    const part = bond ? `bond-${Number(bond[1]) + 1}` : atom ? `atom-${Number(atom[1]) + 1}` : 'other';
    if (!groups.has(part)) groups.set(part, []);
    groups.get(part).push(`<path d="${d.replace(/\s+/g, ' ').trim()}" ${paint}/>`);
  }
  let body = '';
  for (const [part, paths] of groups) body += part === 'other' ? `<g>${paths.join('')}</g>` : `<g ${partAttrs(prefix, part)}>${paths.join('')}</g>`;
  return { body, parts: [...groups.keys()].filter((k) => k !== 'other') };
}

/**
 * The molecule, or a refusal. `rdkit` is the loaded RDKit module.
 * @returns {{ ok: true, ... } | { ok: false, reason: string }}
 */
export function renderMolecule(spec, { prefix, rdkit }) {
  const mol = rdkit.get_mol(spec.smiles);
  if (!mol) return { ok: false, reason: `The structure "${spec.smiles}" is not a molecule the chemistry engine can read: check the SMILES string.` };
  try {
    if (!mol.is_valid()) return { ok: false, reason: `The structure "${spec.smiles}" is not a valid molecule: check the SMILES string.` };
    const atoms = atomsOf(mol);
    if (atoms.length > 120) return { ok: false, reason: 'That molecule has more than 120 atoms: too many to read on a phone.' };
    const counts = {};
    let charge = 0;
    for (const a of atoms) {
      counts[a.symbol] = (counts[a.symbol] ?? 0) + 1;
      if (a.h) counts.H = (counts.H ?? 0) + a.h;
      charge += a.charge;
    }
    const formula = hill(counts, charge);
    if (spec.formula && !sameCounts(countsOf(spec.formula), counts)) {
      return { ok: false, reason: `The formula given, ${spec.formula}, does not match the structure drawn, which is ${formula}. Correct one of them.`, formula };
    }
    const W = 380;
    const H = 260;
    const raw = mol.get_svg_with_highlights(JSON.stringify({ width: W, height: H, bondLineWidth: 2, clearBackground: false }));
    const { body, parts } = rebuild(raw, prefix);
    const named = spec.name ? `${spec.name}, ` : '';
    const label = (part) => {
      const [kind, n] = part.split('-');
      return kind === 'atom' ? `atom ${n} (${atoms[Number(n) - 1]?.symbol ?? '?'})` : `bond ${n}`;
    };
    const rows = Object.keys(counts).sort((a, b) => (a === 'C' ? -1 : b === 'C' ? 1 : a === 'H' ? -1 : b === 'H' ? 1 : a.localeCompare(b)))
      .map((el) => [el, String(counts[el])]);
    return {
      ok: true,
      width: W,
      height: H,
      defs: '',
      body,
      parts: parts.map((p) => ({ part: p, label: label(p) })),
      formula,
      title: spec.title || spec.name || 'Molecule',
      description: `The structure of ${named}a molecule with formula ${formula} (written as SMILES ${spec.smiles}). It has ${atoms.length} atom${atoms.length === 1 ? '' : 's'} besides its hydrogens.`,
      table: { caption: `Atoms in ${spec.name || 'the molecule'} (formula ${formula})`, columns: ['Element', 'Count'], rows },
    };
  } finally {
    mol.delete();
  }
}
