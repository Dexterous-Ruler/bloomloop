/**
 * A figure the server drew (batch 8, stimulus kind 'figure'): its SVG as
 * given, on its own light card in either theme, its description, and its data
 * as a real table behind "Show the data". Used by the phone, the hub, the wall,
 * the review screen and the console, so it stays small: no library, no state.
 *
 *   <Figure figure={{ svg, description, table: { caption, columns, rows }, title, caption, step, stepCount }} />
 *
 * The SVG is never recoloured: it is drawn on white in the Forest palette, so
 * on a dark theme it keeps its own white card. It names itself to a screen
 * reader (role="img", its title and its description), so the visible
 * description sits behind "Describe" rather than being read twice. With no
 * SVG (a figure that could not be drawn) the description is the figure.
 *
 * `step` and `stepCount` are the projector's: from step 1 the line under the
 * card says where it is and gives the step's caption (for a call stack, whose
 * drawing already carries it, to screen readers only). `children` go under the
 * card, above the disclosures (ui/FigureSteps.jsx puts its controls there).
 */

import '../styles/figure.css';

export default function Figure({ figure, className = '', children }) {
  if (!figure) return null;
  const { svg, description, table, caption, step, stepCount, type } = figure;
  // The server sends a table with both columns and rows, or none (figures/index.js tableView).
  const rows = table?.rows ?? [];
  const describe = svg && description;

  return (
    <figure className={`fig-view ${className}`}>
      {svg
        // Server-drawn, and checked against an element and attribute allow-list
        // before it left the server (figures/common.js safeSvg).
        ? <div className="fig-card" dangerouslySetInnerHTML={{ __html: svg }} />
        : description && <p className="fig-alone">{description}</p>}
      {stepCount > 0 && step > 0 && (
        <p className="fig-step" aria-live="polite">
          <b>Step {step} of {stepCount}</b>
          {caption && <span className={type === 'stack' ? 'sr-only' : undefined}>{caption}</span>}
        </p>
      )}
      {children}
      {(describe || rows[0]) && (
        <div className="fig-more">
          {describe && (
            <details>
              <summary>Describe</summary>
              <p>{description}</p>
            </details>
          )}
          {rows[0] && (
            <details>
              <summary>Show the data</summary>
              {/* Wide tables scroll sideways on a phone, so the box takes focus. */}
              <div className="fig-table" tabIndex={0} role="region" aria-label="The figure's data">
                <table>
                  {table.caption && <caption>{table.caption}</caption>}
                  <thead>
                    <tr>{table.columns.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      )}
    </figure>
  );
}
