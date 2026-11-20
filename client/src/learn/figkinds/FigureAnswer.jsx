/**
 * Batch 8's five kinds asked on a figure, on the phone: lazy-loaded by
 * learn/Answer.jsx, so /join downloads none of this until one is on screen.
 *
 * Every component takes { question, result, locked, busy, onSubmit } and:
 *  - draws the server's figure (question.stimulus.svg, where there is one) and
 *    answers ON it: parts carry `data-part="<token>"`; plot and number-line
 *    grids map to the drawing through `grid.frame`;
 *  - never marks anything itself and holds no key: it sends exactly the shape
 *    docs/API.md "Batch 8" gives and shows `result.solution` once marked;
 *  - submits through `Send` (learn/Answer.jsx), the phone's one dock button;
 *  - names every control for a screen reader and works by keyboard.
 */
import ChartBars from './ChartBars.jsx';
import Hotspot from './Hotspot.jsx';
import Label from './Label.jsx';
import NumberLine from './NumberLine.jsx';
import Plot from './Plot.jsx';
import '../../styles/figkinds.css';

const BY_KIND = { hotspot: Hotspot, label: Label, plot: Plot, numberline: NumberLine, chart: ChartBars };

export default function FigureAnswer(props) {
  const Kind = BY_KIND[props.question.kind];
  return Kind ? <Kind {...props} /> : null;
}
