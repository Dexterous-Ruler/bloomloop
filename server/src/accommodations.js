// Per-student accommodations - the supports a teacher sets ONCE, on a student,
// which every room that student ever walks into then applies by itself.
//
// Two decisions carry this whole feature.
//
// THE SUPPORT BELONGS TO THE STUDENT, NOT TO THE ASSESSMENT. It lives on the
// account (supabase/migrations/0006_accommodations.sql) and is read on the way into a
// session, so a professor does not build a second version of a bank for the one
// student who needs larger type - and cannot forget it on the week it mattered.
// Attached to the assignment it would have to be set again on every bank, every
// room and every term, which in practice means set on the first and missing on
// the fourth.
//
// NOTHING MAY MARK AN ACCOMMODATED STUDENT. Not a badge on their phone, not a
// column in the live grid, not a flag on an exported row, not a different shape
// of card. A support that announces itself has taken something back from the
// student in exchange for what it gave them, and in a lecture hall the person it
// announces to is the one sitting beside them. The rule is held by the code and
// not by good intentions: what leaves this server is phoneSupports() - a set of
// rendering switches with no student, no name and no word "accommodation"
// anywhere in it - and every other read path in the product is untouched.
//
// WHERE A SUPPORT LANDS is the other half of the design, and the split is not
// cosmetic:
//
//   'phone'   the browser renders the same question differently. Nothing about
//             the question changes, so the phone can be trusted with it: the
//             worst a tampered client can do to itself is pick a bigger font.
//
//   'server'  the QUESTION ITSELF is different for this student. Exactly one
//             support is in this class and it is the reason the class exists.
//             Dropping a distractor in the client would mean the distractor was
//             still SENT - sitting in a socket frame that devtools will print on
//             request, and in the payload of every student who was given the
//             support. An option a student is not offered must never reach their
//             device, so the removal happens in forStudent() and the marking
//             recomputes the same reduction from the same seed.
//
// Pure: no I/O, no framework, no database. questionTypes.js imports FEWER_CHOICES
// from here, so this file has to stay as testable as that one is.

/**
 * The one support key that questionTypes.js acts on, exported so the contract
 * file and this catalogue cannot drift into disagreeing about its spelling.
 * A typo here would not throw anywhere - it would simply stop reducing, silently,
 * for every student who had been given the support.
 */
export const FEWER_CHOICES = 'fewerChoices';

/**
 * Every support the product offers, what it does, and where it takes effect.
 *
 * `label` and `detail` are rendered verbatim by the teacher's screen, which reads
 * this list off the dashboard payload rather than keeping a copy - a hand-kept
 * client mirror of a server list is how a support ends up on screen under the
 * wrong description. `detail` says what the support DOES rather than who it is
 * for: a teacher setting one is choosing an effect, and a screen that says "for
 * dyslexic students" invites a diagnosis nobody on it is qualified to make.
 *
 * Seven, not twenty-one. Each of these is something we can deliver properly on a
 * cheap phone with no network round trip and no third-party service; a translate
 * button we cannot stand behind would be worth less than the empty space.
 */
export const SUPPORTS = [
  {
    key: 'readAloud',
    where: 'phone',
    label: 'Read aloud',
    detail:
      'Adds a control that speaks the question and its choices, using the voice already on the '
      + 'phone. It never starts on its own - a room of phones talking at once would be worse than '
      + 'no support at all - and it can be stopped at any point.',
  },
  {
    key: 'dyslexiaFont',
    where: 'phone',
    label: 'Dyslexia-friendly text',
    detail:
      'Switches to a plainer letterform and opens up the spacing between letters, words and '
      + 'lines. The spacing is the part with evidence behind it, and it works whether or not the '
      + 'phone has a specialist font installed.',
  },
  {
    key: 'largerText',
    where: 'phone',
    label: 'Larger text',
    detail:
      'Raises the type size across the whole question screen. Every control grows with it rather '
      + 'than staying put and clipping, so a longer option is still readable and still tappable.',
  },
  {
    key: 'highContrast',
    where: 'phone',
    label: 'High contrast',
    detail:
      'Deepens the background to black and lifts every piece of text and every border towards '
      + 'white. The six level colours keep their meaning - they are the taxonomy, not decoration.',
  },
  {
    key: 'extraTime',
    where: 'phone',
    label: 'Extra time to read the result',
    detail:
      'BloomLoop does not put a countdown on a question, so there is no clock here to slow down. '
      + 'What it does slow down is the one thing that is timed: after an answer is marked, the '
      + 'phone moves on by itself in a couple of seconds. This gives that several times longer.',
  },
  {
    key: 'noTimer',
    where: 'phone',
    label: 'No timer at all',
    detail:
      'Turns that automatic advance off completely. The next question comes when the student taps '
      + 'for it and not before, so nothing on screen is ever taken away mid-sentence.',
  },
  {
    key: FEWER_CHOICES,
    where: 'server',
    label: 'Fewer answer choices',
    detail:
      'Removes distractors from "choose one" and "choose all that apply" before the question '
      + 'leaves the server, so the options taken away are never sent to the phone at all. The '
      + 'correct answers always survive, and enough distractors are always kept that ticking '
      + 'everything still cannot pass.',
  },
];

export const SUPPORT_KEYS = SUPPORTS.map((s) => s.key);

/** The subset the browser is allowed to know about. See the note at the top. */
const PHONE_KEYS = SUPPORTS.filter((s) => s.where === 'phone').map((s) => s.key);

/**
 * A stored or submitted accommodations object, reduced to what this build
 * actually understands.
 *
 * Only keys in SUPPORT_KEYS survive and only `true` is kept, so the column holds
 * "what is switched on" and absence means off. That is not tidiness: the value
 * comes out of a jsonb column that a future version of this file may have written
 * with keys this one has never heard of, and it goes back in from a request body
 * a browser composed. Neither is allowed to put anything into the object that the
 * rest of the server will then read as a support.
 *
 * A key this build does not know is dropped rather than preserved. Preserving it
 * would be kinder to a rollback and much worse for the student: an unknown key
 * survives every write, does nothing, and shows up in nobody's UI - so a support
 * a teacher believes is on is silently off for the whole term.
 */
export function normalise(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const key of SUPPORT_KEYS) if (raw[key] === true) out[key] = true;
  return out;
}

/**
 * What the phone is told, and it is deliberately less than the whole set.
 *
 * `fewerChoices` is absent by design. By the time this is sent the reduction has
 * already happened, the removed options were never serialised, and there is
 * nothing the browser could do with the fact except render it - which is exactly
 * the badge this feature exists to refuse. Sending it would also hand a student's
 * own devtools the sentence "you were given a shorter list than the others".
 *
 * Every key is always present, true or false, so the client never has to
 * distinguish "off" from "this server is older than my code".
 */
export function phoneSupports(accommodations) {
  const on = normalise(accommodations);
  const out = {};
  for (const key of PHONE_KEYS) out[key] = Boolean(on[key]);
  return out;
}

/** Are these two phone-facing sets the same? Key order is fixed by PHONE_KEYS. */
export const sameSupports = (a, b) => PHONE_KEYS.every((k) => Boolean(a?.[k]) === Boolean(b?.[k]));

export const isOn = (accommodations, key) => accommodations?.[key] === true;

/** Does this student have anything at all set? Used only by the teacher's own screen. */
export const anyOn = (accommodations) => SUPPORT_KEYS.some((k) => isOn(accommodations, k));
