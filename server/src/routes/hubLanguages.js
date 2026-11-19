// /api/hub - the English, Hindi and Marathi switch (Phase 6, decision H12,
// under decision 5).
//
// Behind the hub's own gate (hubGate in routes/hub.js), and the hub's one rule
// for who reaches what (services/hubAccess.js). A student chooses a language and
// reads an approved translation, or English with a plain note; nothing here
// shows a student a draft. The chapter's owner makes translations (on the
// button, in the background), writes or edits them, and approves or discards
// them; an HOD reads them and changes nothing (403); anyone else gets the 404.
//
//   GET    /language                                    a student's language and the choices
//   PUT    /language                                    a student chooses { language: 'en'|'hi'|'mr' }
//   GET    /chapters/:contentId/translations            staff: every item a student reads, its English and its translations (?language=)
//   POST   /chapters/:contentId/translations/generate   owner: translate on the model { languages, items? } (202, a run)
//   GET    /translations/run/:runId                     that run's progress, for its owner
//   POST   /translations                                owner: write one by hand { itemKind, itemId, language, fields }
//   PATCH  /translations/:translationId                 owner: edit a draft { fields }
//   POST   /translations/:translationId/approve         owner: { confirmFlags? }
//   POST   /translations/:translationId/discard         owner: discard a draft
//   GET    /chapters/:contentId/languages               staff: the chapter's questions, right and wrong by the language shown (hub attempts)

import express from 'express';

import { getRepo } from '../repo/index.js';
import { isRecordId } from '../ids.js';
import { hasGemini } from '../config.js';
import { hubGate } from './hub.js';
import { READ_ONLY, assertStaff, hubChapter, hubChapterToEdit } from '../services/hubAccess.js';
import { cleanRunId, failRun, finishRun, getRun, startRun, updateRun } from '../services/runs.js';
import { TRANSLATION_NOTE } from '../services/honesty.js';
import {
  ITEM_KINDS, LANGUAGES, MAX_RUN_ITEMS, MAX_TRANSLATED_FIELD, OFFLINE_NOTE, ORIGINAL, STALE_NOTE, TERMS_NOTE, TRANSLATED_LANGUAGES,
  checkTranslation, fieldsOf, isCurrent, isLanguage, languageChoice, languageChoices, languageItemStats, sourceHash, translatable,
  translateItems, translationView,
} from '../services/hubLanguages.js';
import { withLock } from '../services/hubLessons.js';
import { tutorTranslationItems } from '../services/hubTutor.js';
import { attemptStoreConnected, listHubAttempts } from '../services/hubAttemptBridge.js';
import { holdsContact } from '../services/roster.js';

const router = express.Router();
router.use(hubGate);

const fail = (message, status) => Object.assign(new Error(message), { status });

export const TRANSLATION_NOT_FOUND = 'That translation was not found.';
export const ITEM_NOT_FOUND = 'That item was not found.';
export const STUDENTS_CHOOSE = 'The language is each student\'s own choice. Preview a lesson in another language to see what they see.';

const ownerKey = (req) => String(req.viewer?.id ?? '');
const sameId = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

/** Run `work` after the reply, and settle the run with its outcome. Never rejects. */
function inBackground(runId, work) {
  Promise.resolve().then(work).then(
    (patch) => finishRun(runId, patch ?? {}),
    (err) => {
      failRun(runId, err.message);
      if (!err.status || err.status >= 500) console.error('[hub] a background run failed:', err);
    },
  );
}

const languagesAsked = (raw) => {
  const list = raw === undefined ? [...TRANSLATED_LANGUAGES] : Array.isArray(raw) ? raw.map(String) : [String(raw)];
  if (!list.length || !list.every((l) => TRANSLATED_LANGUAGES.includes(l))) {
    throw fail('Choose Hindi, Marathi or both to translate into.', 400);
  }
  return [...new Set(list)];
};

/**
 * The chapter's items a student reads: its approved questions, their
 * explanations (a draft or approved; named by the question's id), and its
 * lessons in use (a draft or the one serving).
 */
async function chapterItems(repo, content) {
  const [questions, lessons] = await Promise.all([
    repo.listQuestions(content._id, { includeDiscarded: true }),
    repo.listTopicLessons({ contentId: content._id }),
  ]);
  const active = questions.filter((q) => q.status === 'active');
  // Without 0026's explanations table the questions and lessons are still listed.
  const explanations = await repo.listQuestionExplanations(active.map((q) => String(q._id))).catch((err) => {
    console.error('[hub] explanations could not be read for translating:', err.message);
    return [];
  });
  // The tutor's hints and feedback (H13); without 0029's tables the rest are still listed.
  const tutor = await tutorTranslationItems(repo, active).catch((err) => {
    console.error('[hub] hints and feedback could not be read for translating:', err.message);
    return [];
  });
  return [
    ...active.map((item) => ({ kind: 'question', item })),
    ...explanations.map((e) => ({ kind: 'explanation', item: { ...e, _id: e.questionId, contentId: content._id } })),
    ...tutor,
    ...lessons.filter((l) => l.status === 'draft' || l.status === 'approved').map((item) => ({ kind: 'lesson', item })),
  ];
}

/** One item of this chapter by kind and id, or the one 404. */
async function itemOf(repo, content, kind, rawId) {
  if (!ITEM_KINDS.includes(kind)) throw fail(ITEM_NOT_FOUND, 404);
  const spec = translatable(kind);
  const id = String(rawId ?? '').trim();
  const item = isRecordId(id) ? await spec.load(repo, id) : null;
  if (!item || !sameId(spec.contentIdOf(item), content._id)) throw fail(ITEM_NOT_FOUND, 404);
  return item;
}

/** A translation this viewer may read as staff, with its chapter's context and its item, or the one 404. */
async function staffTranslation(repo, viewer, rawId) {
  assertStaff(viewer);
  const id = String(rawId ?? '').trim();
  const t = isRecordId(id) ? await repo.getItemTranslation(id) : null;
  if (!t) throw fail(TRANSLATION_NOT_FOUND, 404);
  let ctx;
  try {
    ctx = await hubChapter(repo, viewer, t.contentId);
  } catch (err) {
    if (err.status === 404) throw fail(TRANSLATION_NOT_FOUND, 404);
    throw err;
  }
  const item = await translatable(t.itemKind).load(repo, t.itemId);
  return { ...ctx, translation: t, item };
}

/** Fields sent by a professor, held to the item's English: its keys only, a text for a text, a list for a list. */
function fieldsFrom(raw, english) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw fail('Send the translation as its fields: the question, and each option.', 400);
  const out = {};
  const keep = (v) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, MAX_TRANSLATED_FIELD) : null);
  for (const [key, want] of Object.entries(english)) {
    if (raw[key] === undefined) continue;
    if (Array.isArray(want)) {
      if (!Array.isArray(raw[key])) throw fail('The options are a list, one entry for each option in order.', 400);
      out[key] = raw[key].map(keep).map((v) => v ?? '');
    } else {
      const got = keep(raw[key]);
      if (got === null) throw fail('Each translated field is text.', 400);
      out[key] = got;
    }
  }
  if (!Object.keys(out).length) throw fail('None of the fields sent is one this item has.', 400);
  if (holdsContact(JSON.stringify(out))) throw fail('A translation cannot hold contact details.', 400);
  return out;
}

/** Each item with its English and, per language, its translations as staff read them. */
function itemView(kind, item, rows) {
  const english = fieldsOf(kind, item);
  const per = {};
  for (const lang of TRANSLATED_LANGUAGES) {
    const mine = rows.filter((t) => t.language === lang);
    const serving = mine.find((t) => t.status === 'approved') ?? null;
    const drafts = mine.filter((t) => t.status === 'draft');
    per[lang] = {
      serving: serving ? translationView(serving, english) : null,
      drafts: drafts.map((t) => translationView(t, english)),
      shown: serving && isCurrent(serving, english) ? lang : ORIGINAL,
    };
  }
  return {
    kind,
    id: String(item._id),
    ...(kind === 'lesson' ? { topicId: String(item.topicId), version: item.version, status: item.status } : { status: item.status }),
    english,
    note: translatable(kind).note?.(item) ?? null,
    translations: per,
  };
}

// ------------------------------------------------------------ choosing --

router.get('/language', async (req, res, next) => {
  try {
    if (req.viewer.role !== 'student') throw fail(STUDENTS_CHOOSE, 403);
    res.json({
      language: await languageChoice(getRepo(), req.viewer),
      choices: languageChoices(),
      note: 'Your professor checks every translation before you see it. Until one is checked, you see the English, with a note.',
    });
  } catch (err) {
    next(err);
  }
});

router.put('/language', async (req, res, next) => {
  try {
    if (req.viewer.role !== 'student') throw fail(STUDENTS_CHOOSE, 403);
    const language = String(req.body?.language ?? '');
    if (!isLanguage(language)) throw fail('Choose English, Hindi or Marathi.', 400);
    const saved = await getRepo().setLanguageChoice(req.viewer.id, language);
    res.json({ language: saved.language, choices: languageChoices() });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------- reading --

router.get('/chapters/:contentId/translations', async (req, res, next) => {
  try {
    assertStaff(req.viewer);
    const repo = getRepo();
    const ctx = await hubChapter(repo, req.viewer, req.params.contentId);
    const only = req.query.language === undefined ? null : String(req.query.language);
    if (only !== null && !TRANSLATED_LANGUAGES.includes(only)) throw fail('Ask for Hindi (hi) or Marathi (mr), or leave the language out.', 400);
    const [items, rows] = await Promise.all([
      chapterItems(repo, ctx.content),
      repo.listItemTranslations({ contentId: ctx.content._id }),
    ]);
    const views = items.map(({ kind, item }) => itemView(kind, item, rows.filter((t) => t.itemKind === kind && sameId(t.itemId, item._id))));
    const counts = Object.fromEntries(TRANSLATED_LANGUAGES.map((lang) => [lang, {
      items: views.length,
      shown: views.filter((v) => v.translations[lang].shown === lang).length,
      drafts: views.reduce((n, v) => n + v.translations[lang].drafts.length, 0),
      outOfDate: views.filter((v) => v.translations[lang].serving?.stale).length,
    }]));
    if (only) for (const v of views) for (const lang of TRANSLATED_LANGUAGES) if (lang !== only) delete v.translations[lang];
    res.json({
      chapter: { id: String(ctx.content._id), title: ctx.content.title ?? '' },
      canEdit: ctx.canEdit,
      languages: Object.values(LANGUAGES),
      items: views,
      counts: only ? { [only]: counts[only] } : counts,
      notes: {
        terms: TERMS_NOTE,
        students: 'A student who chose Hindi or Marathi sees a translation only once you approve it, and only while its English is unchanged. '
          + 'Otherwise they see the English, with a note.',
        keys: 'Only what a student reads is translated: a question\'s wording and its options, its explanation (shown only after an answer), '
          + 'its hints and the feedback on its wrong options, and the lessons. The answer key is never translated or shown, '
          + 'and a translated hint that would give the answer away is never shown either.',
        stale: STALE_NOTE,
        model: hasGemini() ? 'Translations are drafted by the AI model on your button.' : OFFLINE_NOTE,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/translations/run/:runId', (req, res, next) => {
  try {
    assertStaff(req.viewer);
    const run = getRun(req.params.runId, ownerKey(req));
    if (!run) throw fail('No such run.', 404);
    res.json({ run });
  } catch (err) {
    next(err);
  }
});

router.get('/chapters/:contentId/languages', async (req, res, next) => {
  try {
    assertStaff(req.viewer);
    const repo = getRepo();
    const ctx = await hubChapter(repo, req.viewer, req.params.contentId);
    const questions = (await repo.listQuestions(ctx.content._id, { includeDiscarded: true })).filter((q) => q.status !== 'draft');
    const attempts = await listHubAttempts(repo, { contentId: String(ctx.content._id) });
    const items = languageItemStats(attempts, questions);
    res.json({
      chapter: { id: String(ctx.content._id), title: ctx.content.title ?? '' },
      items,
      warnings: items.filter((i) => i.warning).map((i) => ({ questionId: i.questionId, text: i.warning.text })),
      method: 'Each student\'s first answer to each question in the hub, split by the language it was shown in. '
        + 'Room answers are not counted here.',
      note: TRANSLATION_NOTE,
      ...(attemptStoreConnected() ? {} : { stored: 'No hub answers are stored on this server yet, so there is nothing to compare.' }),
    });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------- writing --

router.post('/chapters/:contentId/translations/generate', async (req, res, next) => {
  try {
    const repo = getRepo();
    const ctx = await hubChapterToEdit(repo, req.viewer, req.params.contentId);
    const languages = languagesAsked(req.body?.languages);
    let items;
    if (req.body?.items !== undefined) {
      if (!Array.isArray(req.body.items) || !req.body.items.length) throw fail('Choose the items to translate, or leave the list out for all of them.', 400);
      items = [];
      for (const it of req.body.items) items.push({ kind: String(it?.kind ?? ''), item: await itemOf(repo, ctx.content, String(it?.kind ?? ''), it?.id) });
    } else {
      items = await chapterItems(repo, ctx.content);
    }
    if (!items.length) throw fail('This chapter has no approved question or lesson to translate yet.', 409);

    const runId = startRun({ id: cleanRunId(req.body?.runId), ownerKey: ownerKey(req), total: items.length * languages.length, topicsTotal: languages.length });
    const viewer = req.viewer;
    const content = ctx.content;
    inBackground(runId, () => withLock(`translations:${content._id}`, async () => {
      let written = 0;
      let missed = 0;
      const warnings = [];
      const rows = await repo.listItemTranslations({ contentId: content._id, status: ['draft', 'approved'] });
      for (const [n, language] of languages.entries()) {
        updateRun(runId, { topic: LANGUAGES[language].name });
        // An item whose current English already has a draft or an approved
        // translation in this language is not sent again: no quota spent twice.
        const wanted = items.filter(({ kind, item }) => {
          const english = fieldsOf(kind, item);
          return Object.keys(english).length && !rows.some((t) => t.itemKind === kind && sameId(t.itemId, item._id)
            && t.language === language && isCurrent(t, english));
        }).slice(0, MAX_RUN_ITEMS);
        const out = await translateItems({
          language,
          items: wanted.map(({ kind, item }) => ({ key: `${kind}:${item._id}`, fields: fieldsOf(kind, item) })),
        });
        for (const r of out.results) {
          const { kind, item } = wanted.find((w) => `${w.kind}:${w.item._id}` === r.key);
          const english = fieldsOf(kind, item);
          await repo.addItemTranslation({
            itemKind: kind,
            itemId: item._id,
            contentId: content._id,
            ownerId: content.ownerId ?? null,
            language,
            fields: r.fields,
            sourceFields: english,
            sourceHash: sourceHash(english),
            provenance: 'ai',
            model: out.model,
            checks: checkTranslation(english, r.fields).findings,
            createdBy: viewer.id ?? null,
          });
          written += 1;
          updateRun(runId, { written });
        }
        missed += out.skipped.length;
        warnings.push(...out.warnings);
        updateRun(runId, { topicsDone: n + 1 });
      }
      // The run has one field for a sentence; a finished run with one says what was not done.
      const said = [...new Set(warnings)];
      if (missed) said.push(`${missed} item${missed === 1 ? ' was' : 's were'} not translated; make the translations again to retry them.`);
      return { written, error: said.join(' ') };
    }));
    res.status(202).json({
      runId,
      state: 'running',
      note: hasGemini()
        ? 'The translations are being drafted. Each arrives as a draft for you to check and approve; students see none until then.'
        : OFFLINE_NOTE,
      items: items.length,
      languages,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/translations', async (req, res, next) => {
  try {
    assertStaff(req.viewer);
    const repo = getRepo();
    const body = req.body ?? {};
    const kind = String(body.itemKind ?? '');
    if (!ITEM_KINDS.includes(kind)) throw fail('Say what is translated: a question, its explanation, a hint, feedback on an option or a lesson.', 400);
    const language = String(body.language ?? '');
    if (!TRANSLATED_LANGUAGES.includes(language)) throw fail('A translation is into Hindi or Marathi.', 400);
    // The item's chapter decides who may write it: its owner.
    const spec = translatable(kind);
    const id = String(body.itemId ?? '').trim();
    const item = isRecordId(id) ? await spec.load(repo, id) : null;
    if (!item) throw fail(ITEM_NOT_FOUND, 404);
    let ctx;
    try {
      ctx = await hubChapterToEdit(repo, req.viewer, spec.contentIdOf(item));
    } catch (err) {
      if (err.status === 404) throw fail(ITEM_NOT_FOUND, 404);
      throw err;
    }
    const english = fieldsOf(kind, item);
    if (!Object.keys(english).length) throw fail('This item has nothing a student reads to translate.', 409);
    const fields = fieldsFrom(body.fields, english);
    const check = checkTranslation(english, fields);
    const made = await repo.addItemTranslation({
      itemKind: kind,
      itemId: item._id,
      contentId: ctx.content._id,
      ownerId: ctx.content.ownerId ?? null,
      language,
      fields,
      sourceFields: english,
      sourceHash: sourceHash(english),
      provenance: 'professor',
      model: null,
      checks: check.findings,
      createdBy: req.viewer.id ?? null,
    });
    res.status(201).json({ translation: translationView(made, english), ...checkMessage(check) });
  } catch (err) {
    next(err);
  }
});

/** What a reply says about the check, plainly. */
function checkMessage(check) {
  if (check.blocking.length) {
    return { message: `Saved as a draft. It cannot be approved yet: ${check.blocking.map((f) => f.message).join(' ')}` };
  }
  if (check.flags.length) {
    return { message: `Saved as a draft. Check these before you approve it: ${check.flags.map((f) => f.message).join(' ')}` };
  }
  return { message: 'Saved as a draft. The check found nothing to look at; approve it when you have read it.' };
}

router.patch('/translations/:translationId', async (req, res, next) => {
  try {
    const repo = getRepo();
    const ctx = await staffTranslation(repo, req.viewer, req.params.translationId);
    if (!ctx.canEdit) throw fail(READ_ONLY, 403);
    if (!ctx.item) throw fail('The item this translates is no longer there, so it cannot be edited.', 409);
    const english = fieldsOf(ctx.translation.itemKind, ctx.item);
    // Edited against the English the item holds now, so an out-of-date
    // translation is brought up to date by editing it.
    const fields = { ...ctx.translation.fields, ...fieldsFrom(req.body?.fields, english) };
    for (const key of Object.keys(fields)) if (!(key in english)) delete fields[key];
    const check = checkTranslation(english, fields);
    const edited = await withLock(`translation:${ctx.translation.itemKind}:${ctx.translation.itemId}`, () => repo.editItemTranslation(ctx.translation._id, {
      fields,
      sourceFields: english,
      sourceHash: sourceHash(english),
      checks: check.findings,
      provenance: 'professor',
      editedBy: req.viewer.id ?? null,
    }));
    if (!edited) throw fail(TRANSLATION_NOT_FOUND, 404);
    res.json({ translation: translationView(edited, english), ...checkMessage(check) });
  } catch (err) {
    next(err);
  }
});

router.post('/translations/:translationId/approve', async (req, res, next) => {
  try {
    const repo = getRepo();
    const ctx = await staffTranslation(repo, req.viewer, req.params.translationId);
    if (!ctx.canEdit) throw fail(READ_ONLY, 403);
    const t = ctx.translation;
    if (t.status !== 'draft') throw fail(`Only a draft translation can be approved; this one is ${t.status}.`, 409);
    if (!ctx.item) throw fail('The item this translates is no longer there, so it cannot be approved.', 409);
    const english = fieldsOf(t.itemKind, ctx.item);
    if (!isCurrent(t, english)) throw fail(STALE_NOTE, 409);
    // Checked again here, never trusted from the row.
    const check = checkTranslation(english, t.fields);
    if (check.blocking.length) {
      throw fail(`This translation cannot be approved: ${check.blocking.map((f) => f.message).join(' ')} Edit it, or make it again.`, 409);
    }
    if (check.flags.length && req.body?.confirmFlags !== true) {
      throw fail(`Check these first: ${check.flags.map((f) => f.message).join(' ')} If the translation is right as it is, `
        + 'approve it again, confirming that you checked them.', 409);
    }
    const before = (await repo.listItemTranslations({ itemKind: t.itemKind, itemIds: [String(t.itemId)], language: t.language, status: 'approved' }))[0] ?? null;
    const approved = await withLock(`translation:${t.itemKind}:${t.itemId}`, () => repo.approveItemTranslation(t._id, { by: req.viewer.id ?? null }));
    if (!approved) throw fail(TRANSLATION_NOT_FOUND, 404);
    res.json({
      translation: translationView(approved, english),
      message: `Approved. Students who chose ${LANGUAGES[t.language].name} now see it${before ? ', in place of the one approved before' : ''}.`,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/translations/:translationId/discard', async (req, res, next) => {
  try {
    const repo = getRepo();
    const ctx = await staffTranslation(repo, req.viewer, req.params.translationId);
    if (!ctx.canEdit) throw fail(READ_ONLY, 403);
    const t = ctx.translation;
    const discarded = await withLock(`translation:${t.itemKind}:${t.itemId}`, () => repo.discardItemTranslation(t._id, { by: req.viewer.id ?? null }));
    if (!discarded) throw fail(TRANSLATION_NOT_FOUND, 404);
    res.json({
      translation: translationView(discarded, ctx.item ? fieldsOf(t.itemKind, ctx.item) : null),
      message: 'Discarded. Students never saw it.',
    });
  } catch (err) {
    next(err);
  }
});

export default router;
