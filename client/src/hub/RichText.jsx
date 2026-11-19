/**
 * Text the server has already built: formulas as MathML, code already
 * highlighted, everything escaped on the server. It is drawn as given, in its
 * own container, so its styles never leak into the screen around it.
 *
 *   html   the server's HTML (preferred when present)
 *   text   the plain version, drawn when there is no HTML
 *   lang   the language the text is in ('hi', 'mr'), so a screen reader and
 *          the browser's hyphenation and fonts treat it right
 *
 * Never pass anything a person typed into `html`: only the server's own
 * rendered fields go here.
 */

export default function RichText({ html, text, lang, className = '', as: Tag = 'div' }) {
  const cls = `hub-rich${className ? ` ${className}` : ''}`;
  // eslint-disable-next-line react/no-danger
  if (html) return <Tag className={cls} lang={lang} dangerouslySetInnerHTML={{ __html: html }} />;
  return <Tag className={cls} lang={lang}>{text}</Tag>;
}
