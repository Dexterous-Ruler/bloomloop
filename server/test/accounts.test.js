// The account code generator, on its own.
//
// makeCode is the only part of services/accounts.js that can be tested without
// a database, and it is also the part worth testing: a code goes on a printed
// roster and gets typed back in by hand, so an ambiguous character or a skewed
// draw is a support ticket, not a rounding error. Every random test here is
// driven by a seeded rng or bounded far outside the noise, because a flaky test
// the morning of the demo is worse than no test at all.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { makeCode, CODE_ALPHABET, CODE_PREFIX, CODE_LENGTH } from '../src/services/accounts.js';

/** mulberry32 - a tiny, well-known, fully deterministic PRNG in [0, 1). */
function seeded(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const body = (code) => code.slice(CODE_PREFIX.length);

describe('makeCode - shape', () => {
  test('is BL- plus exactly six characters', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = makeCode();
      assert.match(code, /^BL-[0-9A-Z]{6}$/);
      assert.equal(code.length, CODE_PREFIX.length + CODE_LENGTH);
      assert.equal(code.slice(0, 3), 'BL-');
    }
  });

  test('the contract constants are the ones being generated', () => {
    assert.equal(CODE_PREFIX, 'BL-');
    assert.equal(CODE_LENGTH, 6);
    assert.equal(CODE_ALPHABET, '0123456789ABCDEFGHJKMNPQRSTVWXYZ');
    assert.equal(CODE_ALPHABET.length, 32);
    assert.equal(new Set(CODE_ALPHABET).size, 32, 'no character repeats in the alphabet');
  });
});

describe('makeCode - alphabet', () => {
  test('every character comes from Crockford base32', () => {
    for (let i = 0; i < 500; i += 1) {
      for (const ch of body(makeCode())) {
        assert.ok(CODE_ALPHABET.includes(ch), `unexpected character ${JSON.stringify(ch)}`);
      }
    }
  });

  test('never emits the ambiguous characters I, L, O or U', () => {
    // I/1, L/1 and O/0 are the pairs people mistype off a projector; U is
    // dropped so a random draw cannot spell something unfortunate.
    for (const ch of 'ILOU') assert.ok(!CODE_ALPHABET.includes(ch), `${ch} must not be in the alphabet`);

    for (let i = 0; i < 2000; i += 1) {
      assert.doesNotMatch(body(makeCode()), /[ILOU]/);
    }
  });

  test('is upper case only - no lower case twin to confuse a reader', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = makeCode();
      assert.equal(code, code.toUpperCase());
    }
  });
});

describe('makeCode - distribution', () => {
  test('10k draws use all 32 characters at roughly equal rates', () => {
    const DRAWS = 10000;
    const counts = new Map([...CODE_ALPHABET].map((ch) => [ch, 0]));
    const seen = new Set();

    for (let i = 0; i < DRAWS; i += 1) {
      const code = makeCode();
      seen.add(code);
      for (const ch of body(code)) counts.set(ch, counts.get(ch) + 1);
    }

    const total = DRAWS * CODE_LENGTH;
    const expected = total / CODE_ALPHABET.length; // 1875
    // Standard deviation here is ~43, so this band is more than ten sigma wide:
    // it catches a truncated alphabet or an off-by-one index, and never fires
    // on honest randomness.
    const slack = 500;

    for (const [ch, n] of counts) {
      assert.ok(n > 0, `character ${ch} was never drawn`);
      assert.ok(
        Math.abs(n - expected) < slack,
        `character ${ch} drawn ${n} times, expected about ${expected}`,
      );
    }

    // 32^6 is over a billion, so the expected number of duplicate codes in ten
    // thousand draws is about 0.05. Ten would mean the generator is not using
    // its full range.
    assert.ok(seen.size >= DRAWS - 10, `only ${seen.size} distinct codes out of ${DRAWS}`);
  });
});

describe('makeCode - seeded rng', () => {
  test('the same seed produces the same code every time', () => {
    const first = makeCode(seeded(42));
    const second = makeCode(seeded(42));
    assert.equal(first, second);
    assert.match(first, /^BL-[0-9A-Z]{6}$/);
  });

  test('different seeds produce different codes', () => {
    const codes = [1, 2, 3, 4, 5].map((s) => makeCode(seeded(s)));
    assert.equal(new Set(codes).size, codes.length);
  });

  test('a fixed sequence maps straight onto the alphabet', () => {
    // Each value picks index floor(v * 32): 0 -> '0', 31/32 -> 'Z'.
    const values = [0, 1 / 32, 9 / 32, 10 / 32, 31 / 32, 0.5];
    let i = 0;
    const code = makeCode(() => values[i++]);
    assert.equal(code, 'BL-019AZG');
  });

  test('an rng at the very edges of its range stays inside the alphabet', () => {
    assert.equal(makeCode(() => 0), 'BL-000000');
    assert.equal(makeCode(() => 0.9999999), 'BL-ZZZZZZ');
    // Defensive: a badly behaved rng returning exactly 1 must clamp, not index
    // past the end of the alphabet and emit 'undefined'.
    assert.equal(makeCode(() => 1), 'BL-ZZZZZZ');
  });

  test('draws one number per character and no more', () => {
    let calls = 0;
    makeCode(() => {
      calls += 1;
      return 0.5;
    });
    assert.equal(calls, CODE_LENGTH);
  });
});
