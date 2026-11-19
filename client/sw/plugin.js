// Builds the phone's service worker (sw/joinWorker.js) into /sw.js, versioned
// by the build. Production builds only; the dev server never sees it.
//
// What a phone needs to open /join with no network: the entry chunk and every
// chunk it imports statically, the CSS those carry, and the fonts that CSS
// points at for the scripts the phone's own text is in (Latin: Manrope,
// JetBrains Mono, and Atkinson Hyperlegible for the dyslexia support). Other
// subsets, and lazy chunks, are kept by the worker the first time a phone
// loads them. VERSION is a hash of that list, so it changes exactly when one
// of those files does.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TEMPLATE = fileURLToPath(new URL('./joinWorker.js', import.meta.url));
const FONT = /-latin-(?:wght|\d{3})-normal-[^/]*\.woff2$/;
const FAMILIES = /\/assets\/(?:manrope|jetbrains-mono|atkinson-hyperlegible)-/;

export default function joinWorker() {
  return {
    name: 'bloomloop-join-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find((c) => c.type === 'chunk' && c.isEntry);
      if (!entry) return;

      const chunks = new Set();
      const walk = (name) => {
        if (chunks.has(name) || !bundle[name]) return;
        chunks.add(name);
        bundle[name].imports.forEach(walk);
      };
      walk(entry.fileName);

      const css = new Set();
      chunks.forEach((name) => bundle[name].viteMetadata?.importedCss?.forEach((f) => css.add(f)));

      const fonts = new Set();
      css.forEach((name) => {
        const source = String(bundle[name]?.source ?? '');
        for (const m of source.matchAll(/url\((\/assets\/[^)]+\.woff2)\)/g)) {
          if (FONT.test(m[1]) && FAMILIES.test(m[1])) fonts.add(m[1]);
        }
      });

      const shell = [...[...chunks, ...css].map((f) => `/${f}`), ...fonts].sort();
      const version = createHash('sha256').update(shell.join('\n')).digest('hex').slice(0, 12);
      const source = readFileSync(TEMPLATE, 'utf8')
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('__SHELL__', JSON.stringify(shell));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
