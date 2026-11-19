/**
 * The hub's language switch, in every student page's header (HubPage.jsx):
 * English, हिन्दी, मराठी, kept on the server (GET and PUT /api/hub/language,
 * through lang.js). After a change, the screens reload what is open in it.
 *
 * Compact: the three names, each in its own script, and a small button that
 * opens the server's `note` (a professor checks every translation; until then
 * the English shows). A save that is refused says why in the same place.
 * While the choices have not come (or could not: the page says why), nothing
 * is drawn.
 */

import { useEffect, useId, useRef, useState } from 'react';

import { Icon, Tip } from '../ui/index.jsx';
import { langAttr, useHubLanguage } from './lang.js';

export function LanguageView({ language, choices, note, busy = false, error = '', onPick }) {
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState(null);
  const box = useRef(null);
  const id = useId();

  // A refused save opens the note, where the reason is.
  useEffect(() => { if (error) setOpen(true); }, [error]);
  useEffect(() => { if (!busy) setAsked(null); }, [busy]);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  if (!choices?.length) return null;

  const pick = (tag) => {
    if (busy || tag === language) return;
    setAsked(tag);
    onPick?.(tag);
  };

  return (
    <div className="hub-lang" ref={box}>
      <div className="seg" role="group" aria-label="Language" aria-busy={busy ? 'true' : undefined}>
        {choices.map((c) => {
          const label = (
            <button
              key={c.tag}
              type="button"
              aria-pressed={language === c.tag}
              lang={langAttr(c.tag)}
              disabled={busy && asked !== c.tag}
              onClick={() => pick(c.tag)}
            >
              {busy && asked === c.tag && <span className="spinner" aria-hidden="true" />}
              {c.native || c.name}
              {c.native && c.native !== c.name && <span className="sr-only" lang="en"> ({c.name})</span>}
            </button>
          );
          return c.native && c.native !== c.name ? <Tip key={c.tag} label={c.name}>{label}</Tip> : label;
        })}
      </div>
      {(note || error) && (
        <button
          type="button"
          className="hub-lang-info"
          aria-expanded={open}
          aria-controls={id}
          aria-label={error ? 'Your language was not saved: why' : 'About translations'}
          data-error={error ? 'true' : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name={error ? 'alert' : 'info'} />
        </button>
      )}
      {open && (
        <div className="hub-lang-note" id={id} role={error ? 'alert' : 'note'}>
          {error && <p className="hub-lang-error">{error}</p>}
          {note && <p>{note}</p>}
        </div>
      )}
    </div>
  );
}

export default function Language() {
  const { language, choices, note, set, busy, error } = useHubLanguage();
  // Choices that never came: the page itself shows why (a 503 or a 401).
  if (!choices.length) return null;
  return <LanguageView language={language} choices={choices} note={note} busy={busy} error={error} onPick={set} />;
}
