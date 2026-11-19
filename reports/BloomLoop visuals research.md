# Visuals in BloomLoop questions, for every subject

19 November 2026. This is research only: nothing in the product has changed.
Screenshots of the working tests:
- `visuals-all-subjects.png`: one example per subject, every one drawn on the server.
- `visuals-prototype.png`: maths graphs and a formula.
- `visuals-devanagari-test.png`: Hindi and Marathi labels in a diagram.

## The answer

**No single library covers every subject.** The best fit is a small set of free drawing engines that all work the same way:

1. **The AI describes each figure as data, never as code or a picture.** For example: "a flowchart with these boxes and arrows", "the molecule with this SMILES string", "a graph of y = 2x + 1 with point A at (1, 3)".
2. **The server checks that data,** and works out the right answer from it itself.
3. **The server draws the figure** as a vector picture (SVG), along with a text description and a data table.
4. **The phone, the projector, printed papers and offline mode** all show that same finished picture. The phone runs no drawing code, so still figures add nothing to its download.
5. **One shared touch-and-keyboard layer** lets a student tap a part, drag a label onto a figure, or plot a point on any figure from any engine. The server marks it.
6. **For what code can't draw** (anatomy, specimens, apparatus, artworks, engineering drawings, maps), the figure is the professor's own picture. That can be a picture pulled out of their uploaded slides, or one from an openly licensed library with credit. AI-made pictures are never used (decision 4).

Cost: nothing. Every engine is free and open source with a permissive licence. They add about 10 MB to the server's disk and nothing to the phone.

**Matplotlib** isn't needed and would be the wrong fit:
- it's a second language on the server;
- it only makes still pictures;
- AI-written plotting code is a risk;
- running it on the phone means a download of about 13 MB.

**Lucide** (icons, already in the app) is used for pictograms and shape patterns.

## The engines

| Engine | Draws | Licence | Tested on the server (Node, no browser) |
|---|---|---|---|
| **Plots** (our own code, plus d3-scale and d3-shape for axis ticks and curves) | Graphs of functions, data charts (bar, line, pie, histogram, dot, box), number lines, distributions, timelines, supply and demand, motion graphs, titration and climate graphs, shear-force and bending-moment diagrams | ours; ISC | Yes. 1,000 graphs in about 0.16 s |
| **Geometry and vectors** (our own code) | Shapes, angles, constructions, coordinate geometry, free-body diagrams, ray diagrams, trusses | ours | Yes (free-body diagram) |
| **Diagrams** (Graphviz, as WebAssembly) | Flowcharts, trees, process cycles, food webs, state machines, ER diagrams, mind maps, family trees, organisation charts, probability trees, cause and effect | Apache-2.0 | Yes. About 90 ms to start, then 2–40 ms per diagram |
| **Chemistry** (RDKit) | Structures from SMILES, checked as real molecules. RDKit also works out the formula, so an AI mistake is caught | BSD-3 | Yes. About 140 ms to start, about 100 ms per molecule; it refused a broken SMILES string |
| **Formulas** (Temml) | Maths, physics, and chemistry equations and units (`\ce{CH4 + 2O2 -> CO2 + 2H2O}`), as MathML that phones display without fonts or scripts | MIT | Yes |
| **Code** (Shiki) | Highlighted program code for computer science | MIT | Yes. About 200 ms the first time |
| **Symbols** (our own sets, plus Lucide and optionally Bioicons) | Pictograms, shape and figure patterns, simple circuits (battery, resistor, bulb, switch, meters), lab-apparatus icons | ISC; Bioicons varies by icon (mostly CC0 or MIT) | Yes (Lucide pattern) |
| **The professor's pictures** | Anatomy, specimens, apparatus, maps, artworks, engineering drawings, photos | the professor's own, or an open library with credit (Servier Medical Art is CC BY 4.0) | Uploads exist today (PNG, JPEG, WebP; SVG refused on purpose) |

Tables already exist as a question kind, and cover ledgers, journals, Punnett squares and truth tables.

## Subject by subject

| Subject | Typical visuals | Engine | Ways a student answers |
|---|---|---|---|
| Mathematics, statistics | Graphs, charts, number lines, geometry, Venn and tree diagrams, formulas | Plots, Geometry, Diagrams, Formulas | Read off the graph; plot a point or line; mark the number line; set bar heights; pick the matching graph |
| Physics | Motion graphs, free-body diagrams, ray diagrams, simple circuits, waves, formulas and units | Plots, Geometry, Symbols, Formulas | Read off the graph; tap the force; label the diagram; work it out from the figure |
| Chemistry | Structures, reactions, titration and rate graphs, periodic-table pieces, apparatus | Chemistry, Formulas, Plots, the professor's pictures | Tap the functional group (atoms can be picked); match structure to name; read the curve |
| Biology, pharmacy, nursing | Labelled anatomy, cell and plant diagrams, life cycles, food webs, pedigrees, Punnett squares, dose-response curves | The professor's pictures and Servier art, Diagrams, Tables, Plots, Chemistry | Label the diagram (drag labels onto parts); tap the part; order the cycle |
| Computer science, IT | Flowcharts, trees, graphs, state machines, ER and UML diagrams, truth tables, logic, code | Diagrams, Code, Tables | Trace the code or flowchart; tap the node; order the steps; fill the truth table |
| Electrical and electronics | Circuits, waveforms, logic gates, phasors | Symbols (simple circuits), Plots, Geometry, the professor's pictures for complex ones | Tap the component; read the waveform; work it out from the circuit |
| Mechanical and civil | Free-body diagrams, beams, shear-force and bending-moment diagrams, trusses, engineering drawings | Geometry, Plots, the professor's pictures | Read or plot the diagram; tap the member |
| Commerce, accounting, economics | Supply and demand, cost curves, break-even, charts, ledgers and balance sheets | Plots, Tables | Shift the curve or read the price; complete the ledger |
| Geography | Maps, climate graphs, cross-sections, cycles | The professor's own map pictures, Plots, Diagrams | Tap the place on the map; read the climate graph |
| History, political science | Timelines, cause-and-effect and structure charts, source pictures | Plots (timeline), Diagrams, the professor's pictures | Order the events; place an event on the timeline; match |
| Languages and literature | Mind maps, sentence trees, character maps, picture prompts | Diagrams, the professor's pictures | Label; match; write about the picture |

## One answer layer for every figure

Every engine produces SVG with stable names on its parts:
- the boxes in a diagram;
- the atoms in a molecule;
- the bars in a chart;
- marked regions on a professor's picture.

So one small interactive layer on the phone can run every "do something to the figure" question.

| Interaction | Works on | Example |
|---|---|---|
| **Tap a part** | any figure | "tap the left ventricle", "tap the resistor", "tap the root of the tree" |
| **Label the diagram** (drag labels onto parts) | any figure | Biology, geography, apparatus |
| **Plot or move points**, set a line, mark a number line, set bar heights | plots and geometry | Maths, physics, economics |

Figures can also be the items in kinds we already have: order, match and multiple choice.

The server marks by part name or by geometry, using the same data that drew the figure, so marks are exact and never depend on the phone.

The layer loads only when such a question appears. Its size is an estimate of a few KB, not measured. If we ever need free-hand curves or circles, Mafs (the library behind Khan Academy's graphs, MIT, 94 KB) is the fallback, loaded the same way.

## How the AI produces figures easily

1. When generating from the professor's material, each question may carry **one** figure. The AI picks the engine and fills in that engine's fixed data shape (structured output with one schema per engine).
2. It is told to add a figure only when the figure carries the information being asked about, never as decoration. Bloom levels give it ideas:
   - **Understand:** read the graph or diagram.
   - **Apply:** plot it, or use it.
   - **Analyse:** compare or find the error.
   - **Evaluate:** judge a drawn claim.
   - **Create:** draw something that meets conditions.
3. The server **never runs what the AI wrote**:
   - it writes the Graphviz input itself, from escaped labels and a fixed list of shapes;
   - RDKit checks the SMILES and the formula;
   - plot answers are recalculated;
   - sizes are capped, for example at most 25 diagram boxes.

   A figure that fails these checks is dropped, and the question is flagged for the professor.
4. The text description and data table come from the figure's data, not from the AI, so they always match the picture.
5. Labels are translated into Hindi and Marathi with the rest of the question.
6. The professor sees the drawn figure and approves it like any question (decisions 1 and 5).
7. For subjects code can't draw, the generator can suggest "use the picture on slide 7". This needs one new piece: today the server reads slide pictures only to pull text out of them (OCR). It doesn't keep them as figures yet.

The same engines can draw the figures inside Phase 6 lessons and tutor hints.

## Cheap phones, offline use and accessibility

**Phone download:**
- Still figures need no script on the phone.
- The join page stays under its 161 KiB limit; it is 158.9 KiB after the UI session's latest change.
- The interactive layer is a separate download, fetched only when needed.
- Figures are stored with the question set for offline use (Phase 7).

**Accessibility:**
- Every figure has `role="img"`, a title and a description.
- Every chart and diagram also comes with a data table.
- Points can be moved with the arrow keys, and the new position is read out.
- Nothing relies on colour alone.
- Labels use the app's fonts, including Noto Sans Devanagari.

**The answer never leaks:** the phone's copy of a "plot it" or "label it" figure is drawn without the answer.

## Limits and risks I found

- **Maps of India are a legal matter.** The Criminal Law Amendment Act, 1961 makes publishing a map of India that does not match the Survey of India's maps punishable. In 2025, MeitY had apps removed over wrong maps.
  - We should not draw maps from internet boundary data.
  - Maps come from the professor's own approved map pictures.
  - Generated maps wait for a Survey-of-India-compliant dataset and a lawyer's check.
- **Graphviz measures Hindi and Marathi text too wide,** so boxes come out oversized (see `visuals-devanagari-test.png`). The fix is to measure label widths on the server with the real Noto Devanagari font and pass the sizes in. Test it before relying on Hindi or Marathi diagrams.
- **AI accuracy.** Models make mistakes in SMILES strings and in diagram facts. The structural checks catch broken data. A diagram that is valid but wrong is caught only by the professor's approval, as with every question.
- **Complex circuits and engineering drawings** are beyond our simple symbol set. netlistsvg (MIT) can draw circuits from a netlist, but it hasn't been updated since 2022. For these, the professor's pictures are the fallback.
- **Timelines** need label placement that avoids overlaps. The prototype overlaps close years.
- **Big diagrams** get hard to read. Cap the number of boxes per diagram.
- **RDKit** draws in fixed colours. That's fine for our light theme.
- **Not yet tested:**
  - MathML on a low-end Android phone (KaTeX, drawn on the server, is the fallback);
  - the size of the interactive layer;
  - Devanagari sizing in Graphviz after the fix.

## Phone download size of the libraries I measured (maths and charts)

I bundled each library for a phone, minified and compressed, with React left out since the app already has it. "Downloaded" means what a phone fetches.

| Library | Downloaded (KB) | Licence | Verdict |
|---|---|---|---|
| Our own renderer (prototype) | 1.2 | ours | Draws on the server; the phone needs none of it |
| d3-scale + d3-shape | 14.4 | ISC | Server only |
| uPlot | 22.7 | MIT | Time series only |
| Temml | 58.4 | MIT | Runs on the server |
| function-plot | 66.7 | MIT | Evaluates typed formulas |
| Chart.js | 69.8 | MIT | Canvas: doesn't print sharply and can't be read aloud |
| KaTeX | 75.8 + fonts | MIT | Formula fallback |
| Observable Plot | 93.7 | ISC | Needs a fake browser page on a server |
| Mafs | 94.4 | MIT | Interactive fallback; last stable release Oct 2024 |
| Recharts | 119.2 | MIT | For dashboards, not question figures |
| ECharts (trimmed) | 170.8 | Apache-2.0 | Too heavy |
| JSXGraph | 253.2 | MIT or LGPL | Too heavy for the phone |
| Vega-Lite + Vega | 269.5 | BSD-3 | Heavy; its specs can fetch data from URLs |
| Mermaid | 1,509.9 | MIT | Ten times the phone's whole budget |

**Not suitable:**
- **GeoGebra:** commercial use needs a separate licence.
- **Desmos API:** needs a key and contact with Desmos for production use.
- Both load from their own servers, so neither works offline.
- **Matplotlib on the phone (Pyodide):** about 6.4 MB of runtime plus 6.4 MB for matplotlib, and 4 to 5 seconds to start.

## Decided under your delegation

1. **Phase 6** gets formulas (Temml with chemistry) and code highlighting (Shiki), because lessons and tutor hints need them.
2. **A visuals batch comes right after Phase 6.** It covers:
   - the figure stimulus;
   - the plot, geometry, diagram (Graphviz) and chemistry (RDKit) engines;
   - reusing pictures from the professor's slides;
   - the shared interaction layer (tap a part, label the diagram, plot, number line, bars);
   - figure generation in the AI pipeline.
3. **Later, each after a check:**
   - maps, after a lawyer and a compliant boundary source;
   - circuit symbols beyond the basic set.
4. **On the phone: no matplotlib, GeoGebra, Desmos, Mermaid or AI-made pictures.**

## Sources

- [Khan Academy: rebuilding graphs for accessibility](https://blog.khanacademy.org/rebuilding-graphs-for-accessibility-inside-khan-academys-inclusive-design/)
- [Khan/perseus (MIT)](https://github.com/Khan/perseus)
- [GeoGebra licence](https://geogebra.org/license)
- [Desmos API](https://www.desmos.com/api)
- [JSXGraph](https://jsxgraph.uni-bayreuth.de/home/)
- Learnosity question types:
  - [graph plotting](https://help.learnosity.com/hc/en-us/articles/16685295290397-Graph-plotting-graphplotting)
  - [chart](https://help.learnosity.com/hc/en-us/articles/16685246434077-Chart-simplechart)
  - [number line](https://help.learnosity.com/hc/en-us/articles/16685311813405-Number-line-plot-numberlineplot)
- [TAO: QTI interactions](https://www.taotesting.com/?p=3753)
- [MathML in Chrome 109](https://developer.chrome.com/blog/new-in-chrome-109/)
- [MathML support data](https://web-platform-dx.github.io/web-features-explorer/features/mathml)
- [KaTeX mhchem](https://cdn.jsdelivr.net/npm/katex@0.18.1/contrib/mhchem/README.md)
- [RDKit.js getting started](https://sources.debian.org/src/rdkit/202503.1-4/Code/MinimalLib/docs/GettingStartedInJS.html)
- [netlistsvg](https://github.com/shuckc/netlistsvg)
- [Servier Medical Art terms](https://smart.servier.com/using-smart-images-what-you-can-do/)
- [Bioicons](https://www.github.com/duerrsimon/bioicons)
- [Indian map law: Nyaaya explainer](https://nyaaya.org/nyaaya-weekly/know-your-map-regulating-the-official-boundary-of-india/)
- [Criminal Law Amendment Act 1961, s.2(2)](https://future.indiankanoon.org/doc/1615680/)
- [Ablo app removed over a wrong map of India (2025)](https://telanganatoday.com/govt-orders-google-to-remove-chinese-app-ablo-for-showing-wrong-map-of-india)
- [Pyodide roadmap](https://pyodide-ryanking13.readthedocs.io/en/latest/project/roadmap.html)
- [Pyodide matplotlib packages](https://anaconda.org/pyodide/matplotlib/files?page=1)
- [expr-eval flaw, CVE-2025-12735 (CERT/CC)](https://kb.cert.org/vuls/id/263614)
- [W3C chart taxonomy](https://www.w3.org/wiki/SVG_Accessibility/Chart_Taxonomy)

Measured on this machine with esbuild 0.24.2 and Node 24.22.3. The versions and release dates come from the npm registry: @hpcc-js/wasm-graphviz 1.30.0, @rdkit/rdkit 2026.9.2, temml 0.14.0, shiki 4.6.0, lucide-static 1.76.0.
