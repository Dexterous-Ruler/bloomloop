/**
 * The passage or image a question hangs off, on the teacher's side.
 *
 * An uploaded image lives at /api/media/<id>, and a console <img> cannot load
 * it before a room opens: an <img> carries no bearer token, and the server only
 * shows an upload to anyone while a running room could serve it. So every
 * preview here fetches the bytes with this browser's credentials and shows them
 * from a blob url, revoked when the preview goes.
 *
 * A stimulus is context, never content: it rides on any kind, and several
 * questions share one by each carrying an equal copy (docs/API.md, Phase 2).
 */

import { useEffect, useId, useState } from 'react';

import { api } from '../lib/api.js';
import Stimulus from '../learn/Stimulus.jsx';
import { Button, Field, Icon, Note, Segmented } from '../ui/index.jsx';

/** MAX_STIMULUS_TEXT and MAX_STIMULUS_SOURCE in server/src/questionTypes.js. */
export const MAX_PASSAGE = 4000;
export const MAX_SOURCE = 300;

/** Under /api/media/ on any host: the server judges a url by its path, so does this. */
const MEDIA_PATH = /^(?:https?:\/\/[^/?#]+)?\/api\/media\//i;
export const isMediaUrl = (url) => MEDIA_PATH.test(String(url ?? '').trim());

/**
 * What an <img> can show for this url: `src` is a blob url for an upload, the
 * url itself for anything else, null while it loads or when it could not be
 * fetched (`failed` says which).
 */
function useMedia(url) {
  const u = String(url ?? '').trim();
  const local = isMediaUrl(u);
  const [got, setGot] = useState({ for: null, src: null, failed: false });

  useEffect(() => {
    if (!local) return undefined;
    let live = true;
    let made = null;
    api.mediaBlobUrl(u).then(
      (blob) => {
        if (live) { made = blob; setGot({ for: u, src: blob, failed: false }); } else URL.revokeObjectURL(blob);
      },
      () => { if (live) setGot({ for: u, src: null, failed: true }); },
    );
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [u, local]);

  if (!u) return { src: null, failed: false };
  if (!local) return { src: u, failed: false };
  // A result for the previous url is never shown for this one: its blob url
  // was revoked when the url changed.
  return got.for === u ? got : { src: null, failed: false };
}

/**
 * A url an <img> in the console can load: a blob url for an upload (made with
 * this browser's credentials, revoked on unmount or change), the url itself for
 * an outside one, and null while loading or on error.
 */
export function useMediaSrc(url) {
  return useMedia(url).src;
}

/** An image that says what it was when it does not arrive. */
function Picture({ src, alt }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <p className="au-stim-gone">The image did not load. Its alt text is below.</p>;
  return <img src={src} alt={alt ?? ''} onError={() => setBroken(true)} />;
}

/**
 * A question's stimulus as a teacher checks it: the passage or the picture,
 * where it is from, and an image's alt text. For the bank and the answer key.
 */
export function StimulusView({ stimulus, className = '' }) {
  const isImage = stimulus?.kind === 'image';
  const { src, failed } = useMedia(isImage ? stimulus.url : null);
  if (!stimulus || (!isImage && stimulus.kind !== 'passage')) return null;
  const source = String(stimulus.sourceRef ?? '').trim();

  return (
    <figure className={`au-stim ${className}`}>
      <figcaption className="au-stim-head">
        <Icon name="book" size={14} />
        <span className="strong">{isImage ? 'Image' : 'Passage'}</span>
        {source && <span className="au-stim-src clip" title={source}>from {source}</span>}
      </figcaption>
      <div
        className="au-stim-body"
        tabIndex={0}
        role="region"
        aria-label={isImage ? 'The image this question is about' : 'The passage this question is about'}
      >
        {isImage
          ? (src
            ? <Picture key={src} src={src} alt={stimulus.alt} />
            : failed
              ? <p className="au-stim-gone">This image could not be fetched. Its alt text is below.</p>
              : <div className="skel au-stim-skel" aria-label="Loading the image" />)
          : <p>{stimulus.text}</p>}
      </div>
      {isImage && stimulus.alt && (
        <p className="au-stim-alt"><span className="t-label">Alt text</span> {stimulus.alt}</p>
      )}
    </figure>
  );
}

/** The stimulus drawn by the phone's own renderer, so the preview cannot drift from it. */
function PhonePreview({ stimulus }) {
  const isImage = stimulus.kind === 'image';
  const { src, failed } = useMedia(isImage ? stimulus.url : null);

  let screen;
  if (isImage && failed) {
    screen = <Note tone="bad">The preview could not fetch this image. Check the address, or upload the file again.</Note>;
  } else if (isImage && !src) {
    screen = <div className="skel au-phone-skel" aria-label="Loading the image" />;
  } else {
    // Keyed by what it shows, so the phone's own "image did not load" state
    // starts over when the picture changes.
    screen = <Stimulus key={isImage ? src : 'passage'} stimulus={isImage ? { ...stimulus, url: src } : stimulus} />;
  }

  return (
    <div className="au-phone">
      <span className="eyebrow">On the phone</span>
      <div className="au-phone-screen">{screen}</div>
      <p className="hint">Above the question, and folded to one line with a tap. Where it is from stays on your side.</p>
    </div>
  );
}

/* ------------------------------------------------------------- editing */

/** The editor's working copy of a stored stimulus. Both kinds' fields are kept, so switching back loses nothing. */
export function seedStimulus(s) {
  const kind = s?.kind === 'passage' || s?.kind === 'image' ? s.kind : 'none';
  return {
    kind,
    text: kind === 'passage' ? String(s.text ?? '') : '',
    url: kind === 'image' ? String(s.url ?? '') : '',
    alt: kind === 'image' ? String(s.alt ?? '') : '',
    sourceRef: String(s?.sourceRef ?? ''),
  };
}

/** What the server is sent: the chosen kind's fields only, or null for none. */
export function stimulusFor(d) {
  const source = d.sourceRef.trim() ? { sourceRef: d.sourceRef.trim() } : {};
  if (d.kind === 'passage') return { kind: 'passage', text: d.text, ...source };
  if (d.kind === 'image') return { kind: 'image', url: d.url.trim(), alt: d.alt, ...source };
  return null;
}

function Count({ n, max }) {
  const over = n - max;
  return (
    <span className="au-count" data-over={over > 0 ? 'true' : undefined}>
      {n.toLocaleString('en-GB')} of {max.toLocaleString('en-GB')}{over > 0 ? `, ${over.toLocaleString('en-GB')} over` : ''}
    </span>
  );
}

const kb = (bytes) => `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('en-GB')} KB`;

/**
 * None, a passage or an image. `onChange` takes an updater, so an upload that
 * lands after a keystroke does not put the old text back.
 */
export function StimulusEditor({ value, onChange, contentId, services = api, disabled = false }) {
  const id = useId();
  const [way, setWay] = useState(value.url && !isMediaUrl(value.url) ? 'link' : 'upload');
  const [file, setFile] = useState(null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState('');

  const set = (patch) => { setRefused(''); onChange((s) => ({ ...s, ...patch })); };
  const off = disabled || busy;

  async function upload() {
    setBusy(true);
    setRefused('');
    try {
      const { media } = await services.uploadMedia(file, contentId, value.alt);
      onChange((s) => ({ ...s, url: media.url, alt: s.alt.trim() ? s.alt : (media.alt ?? s.alt) }));
      setFile(null);
    } catch (err) {
      // The server's 400, 413 and 415 are written to be read as they are.
      setRefused(err.message);
    } finally {
      setBusy(false);
    }
  }

  const source = (
    <Field
      label="Where it is from"
      optional
      htmlFor={`${id}-src`}
      hint={(
        <span className="au-hint-row">
          <span>Shown to you and never to students, for example NCERT Biology XI, chapter 13.</span>
          <Count n={value.sourceRef.length} max={MAX_SOURCE} />
        </span>
      )}
    >
      <input id={`${id}-src`} className="input" value={value.sourceRef} disabled={off} onChange={(e) => set({ sourceRef: e.target.value })} />
    </Field>
  );

  const alt = (
    <Field
      label="Alt text"
      htmlFor={`${id}-alt`}
      hint="Required. What a student who cannot see the image needs to know to answer."
    >
      <textarea
        id={`${id}-alt`}
        className="textarea au-alt"
        value={value.alt}
        disabled={off}
        aria-required="true"
        onChange={(e) => set({ alt: e.target.value })}
      />
    </Field>
  );

  const shown = value.kind === 'passage' ? value.text.trim() : value.kind === 'image' ? value.url.trim() : '';
  const altMissing = !value.alt.trim();

  return (
    <div className="stack stack-3">
      <Segmented
        label="Shown above the question"
        value={value.kind}
        onChange={(kind) => set({ kind })}
        options={[
          { id: 'none', label: 'Nothing', disabled: off },
          { id: 'passage', label: 'A passage', disabled: off },
          { id: 'image', label: 'An image', disabled: off },
        ]}
      />

      {value.kind === 'none' && (
        <p className="hint">
          A passage or an image here sits above the question on every phone. Several questions can carry the same one.
        </p>
      )}

      {value.kind === 'passage' && (
        <>
          <Field
            label="Passage"
            htmlFor={`${id}-text`}
            hint={(
              <span className="au-hint-row">
                <span>Line breaks are kept as you type them.</span>
                <Count n={value.text.length} max={MAX_PASSAGE} />
              </span>
            )}
          >
            <textarea id={`${id}-text`} className="textarea au-passage" value={value.text} disabled={off} onChange={(e) => set({ text: e.target.value })} />
          </Field>
          {source}
        </>
      )}

      {value.kind === 'image' && !value.url.trim() && (
        <>
          <Segmented
            label="Where the image comes from"
            value={way}
            onChange={(w) => { setRefused(''); setWay(w); }}
            options={[{ id: 'upload', label: 'Upload a file', disabled: off }, { id: 'link', label: 'Use an address', disabled: off }]}
          />
          {way === 'upload' ? (
            <label className="au-drop" htmlFor={`${id}-file`} data-busy={busy ? 'true' : undefined}>
              <input
                id={`${id}-file`}
                type="file"
                className="sr-only"
                accept="image/png,image/jpeg,image/webp"
                disabled={off}
                onChange={(e) => { setRefused(''); setFile(e.target.files?.[0] ?? null); e.target.value = ''; }}
              />
              <span className="au-drop-ic"><Icon name="upload" /></span>
              <span className="grow">
                {file
                  ? <><b className="clip">{file.name}</b><small>{kb(file.size)}. Choose again to use another file.</small></>
                  : <><b>Choose an image</b><small>PNG, JPEG or WebP, at most 500 KB.</small></>}
              </span>
            </label>
          ) : (
            <Field label="Image address" htmlFor={`${id}-url`} hint="An image already uploaded to this chapter, or one on the web over https.">
              <input id={`${id}-url`} className="input mono" value={link} disabled={off} placeholder="https://" onChange={(e) => { setRefused(''); setLink(e.target.value); }} />
            </Field>
          )}
          {alt}
          {refused && <Note tone="bad" role="alert">{refused}</Note>}
          <div className="cluster">
            {way === 'upload' ? (
              <Button
                icon="upload"
                busy={busy}
                disabled={off || !file || altMissing}
                title={!file ? 'Choose an image first' : altMissing ? 'Write the alt text first' : undefined}
                onClick={upload}
              >
                Upload and attach
              </Button>
            ) : (
              <Button
                icon="link"
                disabled={off || !link.trim() || altMissing}
                title={!link.trim() ? 'Type the address first' : altMissing ? 'Write the alt text first' : undefined}
                onClick={() => set({ url: link.trim() })}
              >
                Use this image
              </Button>
            )}
            <span className="t-meta">It is attached when you save the question.</span>
          </div>
        </>
      )}

      {value.kind === 'image' && value.url.trim() && (
        <>
          <div className="au-attached">
            <Icon name="ok" />
            <span className="grow clip mono" title={value.url}>{isMediaUrl(value.url) ? 'Uploaded to this chapter' : value.url}</span>
            <Button size="sm" variant="ghost" icon="refresh" disabled={off} onClick={() => { setLink(''); setWay('upload'); set({ url: '' }); }}>Replace</Button>
          </div>
          {alt}
          {source}
        </>
      )}

      {shown && <PhonePreview stimulus={stimulusFor(value)} />}
    </div>
  );
}
