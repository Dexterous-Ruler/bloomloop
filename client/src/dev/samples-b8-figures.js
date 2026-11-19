// Figures drawn by the batch 8 server (b8-vis, POST /api/figures/preview) on
// 2026-11-19, kept as gallery fixtures. Development only. Regenerate with the
// scratchpad's tools/figfixtures.mjs; do not edit by hand.
//
// STAFF[name]  the preview's `figure` (figureForStaff): type, title, svg, description,
//              table, ok, parts, stepCount, steps[{ caption, highlight|frames, index }], formula?
// FRAMES[name] each step drawn (preview with step k): [{ caption, svg, description }]
// REFUSED      two 400 replies, as the editor meets them

export const STAFF = {
 "plot": {
  "kind": "figure",
  "type": "plot",
  "title": "A line and a parabola",
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 520 380\" width=\"520\" height=\"380\" role=\"img\" aria-labelledby=\"fig-c4d788667d-title fig-c4d788667d-desc\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" id=\"fig-c4d788667d\"><title id=\"fig-c4d788667d-title\">A line and a parabola</title><desc id=\"fig-c4d788667d-desc\">A graph with x from −5 to 5 (x) and y from −6 to 10 (y). It shows a region shaded from x = −1 to x = 1 under y = x² − 4; the straight line y = 2x + 1 (labelled f); the parabola y = x² − 4; the step graph with 2 pieces; a arrow from (0, 0) to (2, 4); point A at (1, 3).</desc><defs><clipPath id=\"fig-c4d788667d-clip\"><rect x=\"56\" y=\"38\" width=\"444\" height=\"290\"/></clipPath><marker id=\"fig-c4d788667d-arrow\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\" markerUnits=\"userSpaceOnUse\"><path d=\"M0,0 L10,5 L0,10 Z\" fill=\"#1F2A24\"/></marker></defs><rect x=\"0\" y=\"0\" width=\"520\" height=\"380\" fill=\"#FFFFFF\"/><text x=\"260\" y=\"20\" font-size=\"15\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\" font-weight=\"600\">A line and a parabola</text><g stroke=\"#E3E5E0\" stroke-width=\"1\"><line x1=\"56\" y1=\"38\" x2=\"56\" y2=\"328\"/><line x1=\"100.4\" y1=\"38\" x2=\"100.4\" y2=\"328\"/><line x1=\"144.8\" y1=\"38\" x2=\"144.8\" y2=\"328\"/><line x1=\"189.2\" y1=\"38\" x2=\"189.2\" y2=\"328\"/><line x1=\"233.6\" y1=\"38\" x2=\"233.6\" y2=\"328\"/><line x1=\"278\" y1=\"38\" x2=\"278\" y2=\"328\"/><line x1=\"322.4\" y1=\"38\" x2=\"322.4\" y2=\"328\"/><line x1=\"366.8\" y1=\"38\" x2=\"366.8\" y2=\"328\"/><line x1=\"411.2\" y1=\"38\" x2=\"411.2\" y2=\"328\"/><line x1=\"455.6\" y1=\"38\" x2=\"455.6\" y2=\"328\"/><line x1=\"500\" y1=\"38\" x2=\"500\" y2=\"328\"/><line x1=\"56\" y1=\"328\" x2=\"500\" y2=\"328\"/><line x1=\"56\" y1=\"291.75\" x2=\"500\" y2=\"291.75\"/><line x1=\"56\" y1=\"255.5\" x2=\"500\" y2=\"255.5\"/><line x1=\"56\" y1=\"219.25\" x2=\"500\" y2=\"219.25\"/><line x1=\"56\" y1=\"183\" x2=\"500\" y2=\"183\"/><line x1=\"56\" y1=\"146.75\" x2=\"500\" y2=\"146.75\"/><line x1=\"56\" y1=\"110.5\" x2=\"500\" y2=\"110.5\"/><line x1=\"56\" y1=\"74.25\" x2=\"500\" y2=\"74.25\"/><line x1=\"56\" y1=\"38\" x2=\"500\" y2=\"38\"/></g><g stroke=\"#3A4540\" stroke-width=\"1.4\"><line x1=\"56\" y1=\"219.25\" x2=\"500\" y2=\"219.25\"/><line x1=\"278\" y1=\"38\" x2=\"278\" y2=\"328\"/></g><line x1=\"56\" y1=\"219.25\" x2=\"56\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"56\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">−5</text><line x1=\"100.4\" y1=\"219.25\" x2=\"100.4\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"100.4\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">−4</text><line x1=\"144.8\" y1=\"219.25\" x2=\"144.8\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"144.8\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">−3</text><line x1=\"189.2\" y1=\"219.25\" x2=\"189.2\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"189.2\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">−2</text><line x1=\"233.6\" y1=\"219.25\" x2=\"233.6\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"233.6\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">−1</text><line x1=\"278\" y1=\"219.25\" x2=\"278\" y2=\"223.25\" stroke=\"#3A4540\"/><line x1=\"322.4\" y1=\"219.25\" x2=\"322.4\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"322.4\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">1</text><line x1=\"366.8\" y1=\"219.25\" x2=\"366.8\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"366.8\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">2</text><line x1=\"411.2\" y1=\"219.25\" x2=\"411.2\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"411.2\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">3</text><line x1=\"455.6\" y1=\"219.25\" x2=\"455.6\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"455.6\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">4</text><line x1=\"500\" y1=\"219.25\" x2=\"500\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"500\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">5</text><line x1=\"274\" y1=\"328\" x2=\"278\" y2=\"328\" stroke=\"#3A4540\"/><text x=\"271\" y=\"328\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">−6</text><line x1=\"274\" y1=\"291.75\" x2=\"278\" y2=\"291.75\" stroke=\"#3A4540\"/><text x=\"271\" y=\"291.75\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">−4</text><line x1=\"274\" y1=\"255.5\" x2=\"278\" y2=\"255.5\" stroke=\"#3A4540\"/><text x=\"271\" y=\"255.5\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">−2</text><line x1=\"274\" y1=\"219.25\" x2=\"278\" y2=\"219.25\" stroke=\"#3A4540\"/><line x1=\"274\" y1=\"183\" x2=\"278\" y2=\"183\" stroke=\"#3A4540\"/><text x=\"271\" y=\"183\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">2</text><line x1=\"274\" y1=\"146.75\" x2=\"278\" y2=\"146.75\" stroke=\"#3A4540\"/><text x=\"271\" y=\"146.75\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">4</text><line x1=\"274\" y1=\"110.5\" x2=\"278\" y2=\"110.5\" stroke=\"#3A4540\"/><text x=\"271\" y=\"110.5\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">6</text><line x1=\"274\" y1=\"74.25\" x2=\"278\" y2=\"74.25\" stroke=\"#3A4540\"/><text x=\"271\" y=\"74.25\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">8</text><line x1=\"274\" y1=\"38\" x2=\"278\" y2=\"38\" stroke=\"#3A4540\"/><text x=\"271\" y=\"38\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">10</text><text x=\"278\" y=\"366\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\">x</text><g transform=\"translate(16 183) rotate(-90)\"><text x=\"0\" y=\"0\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\">y</text></g><path id=\"fig-c4d788667d-area\" data-part=\"area\" d=\"M233.6,219.25 L233.6,273.63 L234.71,274.52 L235.82,275.39 L236.93,276.24 L238.04,277.07 L239.15,277.87 L240.26,278.65 L241.37,279.41 L242.48,280.15 L243.59,280.86 L244.7,281.55 L245.81,282.22 L246.92,282.87 L248.03,283.49 L249.14,284.09 L250.25,284.67 L251.36,285.23 L252.47,285.76 L253.58,286.27 L254.69,286.75 L255.8,287.22 L256.91,287.66 L258.02,288.08 L259.13,288.48 L260.24,288.85 L261.35,289.2 L262.46,289.53 L263.57,289.84 L264.68,290.12 L265.79,290.38 L266.9,290.62 L268.01,290.83 L269.12,291.03 L270.23,291.19 L271.34,291.34 L272.45,291.47 L273.56,291.57 L274.67,291.65 L275.78,291.7 L276.89,291.74 L278,291.75 L279.11,291.74 L280.22,291.7 L281.33,291.65 L282.44,291.57 L283.55,291.47 L284.66,291.34 L285.77,291.19 L286.88,291.03 L287.99,290.83 L289.1,290.62 L290.21,290.38 L291.32,290.12 L292.43,289.84 L293.54,289.53 L294.65,289.2 L295.76,288.85 L296.87,288.48 L297.98,288.08 L299.09,287.66 L300.2,287.22 L301.31,286.75 L302.42,286.27 L303.53,285.76 L304.64,285.23 L305.75,284.67 L306.86,284.09 L307.97,283.49 L309.08,282.87 L310.19,282.22 L311.3,281.55 L312.41,280.86 L313.52,280.15 L314.63,279.41 L315.74,278.65 L316.85,277.87 L317.96,277.07 L319.07,276.24 L320.18,275.39 L321.29,274.52 L322.4,273.63 L322.4,219.25 Z\" fill=\"#2F6B4F\" fill-opacity=\"0.16\" stroke=\"none\" clip-path=\"url(#fig-c4d788667d-clip)\"/><g id=\"fig-c4d788667d-line\" data-part=\"line\" clip-path=\"url(#fig-c4d788667d-clip)\"><path d=\"M56,382.4L58.2,380.6L60.4,378.8L62.7,376.9L64.9,375.1L67.1,373.3L69.3,371.5L71.5,369.7L73.8,367.9L76,366.1L78.2,364.3L80.4,362.4L82.6,360.6L84.9,358.8L87.1,357L89.3,355.2L91.5,353.4L93.7,351.6L96,349.7L98.2,347.9L100.4,346.1L102.6,344.3L104.8,342.5L107.1,340.7L109.3,338.9L111.5,337.1L113.7,335.3L115.9,333.4L118.2,331.6L120.4,329.8L122.6,328L124.8,326.2L127,324.4L129.3,322.6L131.5,320.8L133.7,318.9L135.9,317.1L138.1,315.3L140.4,313.5L142.6,311.7L144.8,309.9L147,308.1L149.2,306.3L151.5,304.4L153.7,302.6L155.9,300.8L158.1,299L160.3,297.2L162.6,295.4L164.8,293.6L167,291.8L169.2,289.9L171.4,288.1L173.7,286.3L175.9,284.5L178.1,282.7L180.3,280.9L182.5,279.1L184.8,277.2L187,275.4L189.2,273.6L191.4,271.8L193.6,270L195.9,268.2L198.1,266.4L200.3,264.6L202.5,262.8L204.7,260.9L207,259.1L209.2,257.3L211.4,255.5L213.6,253.7L215.8,251.9L218.1,250.1L220.3,248.2L222.5,246.4L224.7,244.6L226.9,242.8L229.2,241L231.4,239.2L233.6,237.4L235.8,235.6L238,233.8L240.3,231.9L242.5,230.1L244.7,228.3L246.9,226.5L249.1,224.7L251.4,222.9L253.6,221.1L255.8,219.3L258,217.4L260.2,215.6L262.5,213.8L264.7,212L266.9,210.2L269.1,208.4L271.3,206.6L273.6,204.8L275.8,202.9L278,201.1L280.2,199.3L282.4,197.5L284.7,195.7L286.9,193.9L289.1,192.1L291.3,190.3L293.5,188.4L295.8,186.6L298,184.8L300.2,183L302.4,181.2L304.6,179.4L306.9,177.6L309.1,175.7L311.3,173.9L313.5,172.1L315.7,170.3L318,168.5L320.2,166.7L322.4,164.9L324.6,163.1L326.8,161.3L329.1,159.4L331.3,157.6L333.5,155.8L335.7,154L337.9,152.2L340.2,150.4L342.4,148.6L344.6,146.8L346.8,144.9L349,143.1L351.3,141.3L353.5,139.5L355.7,137.7L357.9,135.9L360.1,134.1L362.4,132.2L364.6,130.4L366.8,128.6L369,126.8L371.2,125L373.5,123.2L375.7,121.4L377.9,119.6L380.1,117.8L382.3,115.9L384.6,114.1L386.8,112.3L389,110.5L391.2,108.7L393.4,106.9L395.7,105.1L397.9,103.3L400.1,101.4L402.3,99.6L404.5,97.8L406.8,96L409,94.2L411.2,92.4L413.4,90.6L415.6,88.8L417.9,86.9L420.1,85.1L422.3,83.3L424.5,81.5L426.7,79.7L429,77.9L431.2,76.1L433.4,74.3L435.6,72.4L437.8,70.6L440.1,68.8L442.3,67L444.5,65.2L446.7,63.4L448.9,61.6L451.2,59.7L453.4,57.9L455.6,56.1L457.8,54.3L460,52.5L462.3,50.7L464.5,48.9L466.7,47.1L468.9,45.2L471.1,43.4L473.4,41.6L475.6,39.8L477.8,38L480,36.2L482.2,34.4L484.5,32.6L486.7,30.8L488.9,28.9L491.1,27.1L493.3,25.3L495.6,23.5L497.8,21.7L500,19.9\" fill=\"none\" stroke=\"#2F6B4F\" stroke-width=\"2.2\" stroke-linejoin=\"round\"/></g><g id=\"fig-c4d788667d-curve\" data-part=\"curve\" clip-path=\"url(#fig-c4d788667d-clip)\"><path d=\"M56,-161.4L58.2,-152.4L60.4,-143.4L62.7,-134.6L64.9,-125.8L67.1,-117.2L69.3,-108.6L71.5,-100.2L73.8,-91.8L76,-83.5L78.2,-75.3L80.4,-67.2L82.6,-59.2L84.9,-51.2L87.1,-43.4L89.3,-35.6L91.5,-28L93.7,-20.4L96,-12.9L98.2,-5.5L100.4,1.8L102.6,9L104.8,16.1L107.1,23.1L109.3,30L111.5,36.9L113.7,43.6L115.9,50.3L118.2,56.8L120.4,63.3L122.6,69.7L124.8,76L127,82.2L129.3,88.3L131.5,94.4L133.7,100.3L135.9,106.1L138.1,111.9L140.4,117.6L142.6,123.1L144.8,128.6L147,134L149.2,139.3L151.5,144.5L153.7,149.7L155.9,154.7L158.1,159.6L160.3,164.5L162.6,169.2L164.8,173.9L167,178.5L169.2,183L171.4,187.4L173.7,191.7L175.9,195.9L178.1,200L180.3,204L182.5,208L184.8,211.8L187,215.6L189.2,219.3L191.4,222.8L193.6,226.3L195.9,229.7L198.1,233L200.3,236.2L202.5,239.4L204.7,242.4L207,245.4L209.2,248.2L211.4,251L213.6,253.6L215.8,256.2L218.1,258.7L220.3,261.1L222.5,263.4L224.7,265.7L226.9,267.8L229.2,269.8L231.4,271.8L233.6,273.6L235.8,275.4L238,277.1L240.3,278.7L242.5,280.2L244.7,281.6L246.9,282.9L249.1,284.1L251.4,285.2L253.6,286.3L255.8,287.2L258,288.1L260.2,288.8L262.5,289.5L264.7,290.1L266.9,290.6L269.1,291L271.3,291.3L273.6,291.6L275.8,291.7L278,291.8L280.2,291.7L282.4,291.6L284.7,291.3L286.9,291L289.1,290.6L291.3,290.1L293.5,289.5L295.8,288.8L298,288.1L300.2,287.2L302.4,286.3L304.6,285.2L306.9,284.1L309.1,282.9L311.3,281.6L313.5,280.2L315.7,278.7L318,277.1L320.2,275.4L322.4,273.6L324.6,271.8L326.8,269.8L329.1,267.8L331.3,265.7L333.5,263.4L335.7,261.1L337.9,258.7L340.2,256.2L342.4,253.6L344.6,251L346.8,248.2L349,245.4L351.3,242.4L353.5,239.4L355.7,236.2L357.9,233L360.1,229.7L362.4,226.3L364.6,222.8L366.8,219.3L369,215.6L371.2,211.8L373.5,208L375.7,204L377.9,200L380.1,195.9L382.3,191.7L384.6,187.3L386.8,183L389,178.5L391.2,173.9L393.4,169.2L395.7,164.5L397.9,159.6L400.1,154.7L402.3,149.7L404.5,144.5L406.8,139.3L409,134L411.2,128.6L413.4,123.1L415.6,117.6L417.9,111.9L420.1,106.2L422.3,100.3L424.5,94.4L426.7,88.3L429,82.2L431.2,76L433.4,69.7L435.6,63.3L437.8,56.9L440.1,50.3L442.3,43.6L444.5,36.9L446.7,30L448.9,23.1L451.2,16.1L453.4,9L455.6,1.8L457.8,-5.5L460,-12.9L462.3,-20.4L464.5,-28L466.7,-35.6L468.9,-43.4L471.1,-51.2L473.4,-59.2L475.6,-67.2L477.8,-75.3L480,-83.5L482.2,-91.8L484.5,-100.2L486.7,-108.6L488.9,-117.2L491.1,-125.9L493.3,-134.6L495.6,-143.4L497.8,-152.4L500,-161.4\" fill=\"none\" stroke=\"#B7862B\" stroke-width=\"2.2\" stroke-dasharray=\"6 4\" stroke-linejoin=\"round\"/></g><g id=\"fig-c4d788667d-steps\" data-part=\"steps\" clip-path=\"url(#fig-c4d788667d-clip)\"><line x1=\"100.4\" y1=\"309.88\" x2=\"189.2\" y2=\"309.88\" stroke=\"#4F6D8A\" stroke-width=\"2.2\"/><circle cx=\"100.4\" cy=\"309.88\" r=\"4\" fill=\"#4F6D8A\" stroke=\"#4F6D8A\" stroke-width=\"1.6\"/><circle cx=\"189.2\" cy=\"309.88\" r=\"4\" fill=\"#FFFFFF\" stroke=\"#4F6D8A\" stroke-width=\"1.6\"/><line x1=\"189.2\" y1=\"273.63\" x2=\"278\" y2=\"273.63\" stroke=\"#4F6D8A\" stroke-width=\"2.2\"/><circle cx=\"189.2\" cy=\"273.63\" r=\"4\" fill=\"#FFFFFF\" stroke=\"#4F6D8A\" stroke-width=\"1.6\"/><circle cx=\"278\" cy=\"273.63\" r=\"4\" fill=\"#FFFFFF\" stroke=\"#4F6D8A\" stroke-width=\"1.6\"/></g><line id=\"fig-c4d788667d-v\" data-part=\"v\" x1=\"278\" y1=\"219.25\" x2=\"366.8\" y2=\"146.75\" stroke=\"#1F2A24\" stroke-width=\"2\" marker-end=\"url(#fig-c4d788667d-arrow)\" clip-path=\"url(#fig-c4d788667d-clip)\"/><g id=\"fig-c4d788667d-A\" data-part=\"A\"><circle cx=\"322.4\" cy=\"164.88\" r=\"4.5\" fill=\"#1F2A24\" stroke=\"#1F2A24\" stroke-width=\"1.8\"/><text x=\"330.4\" y=\"154.88\" font-size=\"12\" text-anchor=\"start\" dominant-baseline=\"middle\" fill=\"#1F2A24\" font-weight=\"600\">A</text></g></svg>",
  "description": "A graph with x from −5 to 5 (x) and y from −6 to 10 (y). It shows a region shaded from x = −1 to x = 1 under y = x² − 4; the straight line y = 2x + 1 (labelled f); the parabola y = x² − 4; the step graph with 2 pieces; a arrow from (0, 0) to (2, 4); point A at (1, 3).",
  "table": {
   "caption": "What the graph shows",
   "columns": [
    "Part",
    "Value"
   ],
   "rows": [
    [
     "f",
     "y = 2x + 1"
    ],
    [
     "Function",
     "y = x² − 4"
    ],
    [
     "Function",
     "y = −5 for x from −4 to −2; y = −3 for x from −2 to 0"
    ],
    [
     "A",
     "(1, 3)"
    ],
    [
     "Segment",
     "(0, 0) to (2, 4)"
    ],
    [
     "Shaded",
     "x from −1 to 1"
    ]
   ]
  },
  "ok": true,
  "parts": [
   {
    "part": "area",
    "label": "shaded from −1 to 1"
   },
   {
    "part": "line",
    "label": "f: y = 2x + 1"
   },
   {
    "part": "curve",
    "label": "y = x² − 4"
   },
   {
    "part": "steps",
    "label": "a step function"
   },
   {
    "part": "v",
    "label": "segment from (0, 0) to (2, 4)"
   },
   {
    "part": "A",
    "label": "A (1, 3)"
   }
  ],
  "stepCount": 2,
  "steps": [
   {
    "caption": "The line y = 2x + 1.",
    "highlight": [
     "line"
    ],
    "frames": null,
    "index": 1
   },
   {
    "caption": "Point A lies on the line, not the curve.",
    "highlight": [
     "A",
     "curve"
    ],
    "frames": null,
    "index": 2
   }
  ]
 },
 "bar": {
  "kind": "figure",
  "type": "chart",
  "title": "Rainfall",
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 520 380\" width=\"520\" height=\"380\" role=\"img\" aria-labelledby=\"fig-8c69d5b637-title fig-8c69d5b637-desc\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" id=\"fig-8c69d5b637\"><title id=\"fig-8c69d5b637-title\">Rainfall</title><desc id=\"fig-8c69d5b637-desc\">A bar chart of 2024, 2025 across 3 categories: June, July, August. 2024: highest at July (300); 2025: highest at July (340). The values are in the table.</desc><rect x=\"0\" y=\"0\" width=\"520\" height=\"380\" fill=\"#FFFFFF\"/><text x=\"260\" y=\"20\" font-size=\"15\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\" font-weight=\"600\">Rainfall</text><g stroke=\"#E3E5E0\"><line x1=\"56\" y1=\"338\" x2=\"504\" y2=\"338\"/><line x1=\"56\" y1=\"297.71\" x2=\"504\" y2=\"297.71\"/><line x1=\"56\" y1=\"257.43\" x2=\"504\" y2=\"257.43\"/><line x1=\"56\" y1=\"217.14\" x2=\"504\" y2=\"217.14\"/><line x1=\"56\" y1=\"176.86\" x2=\"504\" y2=\"176.86\"/><line x1=\"56\" y1=\"136.57\" x2=\"504\" y2=\"136.57\"/><line x1=\"56\" y1=\"96.29\" x2=\"504\" y2=\"96.29\"/><line x1=\"56\" y1=\"56\" x2=\"504\" y2=\"56\"/></g><text x=\"49\" y=\"338\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">0</text><text x=\"49\" y=\"297.71\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">50</text><text x=\"49\" y=\"257.43\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">100</text><text x=\"49\" y=\"217.14\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">150</text><text x=\"49\" y=\"176.86\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">200</text><text x=\"49\" y=\"136.57\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">250</text><text x=\"49\" y=\"96.29\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">300</text><text x=\"49\" y=\"56\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">350</text><line x1=\"56\" y1=\"56\" x2=\"56\" y2=\"338\" stroke=\"#3A4540\" stroke-width=\"1.4\"/><line x1=\"56\" y1=\"338\" x2=\"504\" y2=\"338\" stroke=\"#3A4540\" stroke-width=\"1.4\"/><g transform=\"translate(16 197) rotate(-90)\"><text x=\"0\" y=\"0\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\">mm</text></g><text x=\"140.87\" y=\"352\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">June</text><text x=\"280\" y=\"352\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">July</text><text x=\"419.13\" y=\"352\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">August</text><rect id=\"fig-8c69d5b637-bar-1-1\" data-part=\"bar-1-1\" x=\"90.78\" y=\"241.31\" width=\"48\" height=\"96.69\" fill=\"#2F6B4F\" stroke=\"#1F2A24\" stroke-width=\"0\"/><text x=\"114.78\" y=\"233.31\" font-size=\"10\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\">120</text><rect id=\"fig-8c69d5b637-bar-1-2\" data-part=\"bar-1-2\" x=\"229.91\" y=\"96.29\" width=\"48\" height=\"241.71\" fill=\"#2F6B4F\" stroke=\"#1F2A24\" stroke-width=\"0\"/><text x=\"253.91\" y=\"88.29\" font-size=\"10\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\">300</text><rect id=\"fig-8c69d5b637-bar-1-3\" data-part=\"bar-1-3\" x=\"369.04\" y=\"168.8\" width=\"48\" height=\"169.2\" fill=\"#2F6B4F\" stroke=\"#1F2A24\" stroke-width=\"0\"/><text x=\"393.04\" y=\"160.8\" font-size=\"10\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\">210</text><rect id=\"fig-8c69d5b637-bar-2-1\" data-part=\"bar-2-1\" x=\"142.96\" y=\"265.49\" width=\"48\" height=\"72.51\" fill=\"#B7862B\" stroke=\"#1F2A24\" stroke-width=\"0\"/><text x=\"166.96\" y=\"257.49\" font-size=\"10\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\">90</text><rect id=\"fig-8c69d5b637-bar-2-2\" data-part=\"bar-2-2\" x=\"282.09\" y=\"64.06\" width=\"48\" height=\"273.94\" fill=\"#B7862B\" stroke=\"#1F2A24\" stroke-width=\"0\"/><text x=\"306.09\" y=\"56.06\" font-size=\"10\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\">340</text><rect id=\"fig-8c69d5b637-bar-2-3\" data-part=\"bar-2-3\" x=\"421.22\" y=\"192.97\" width=\"48\" height=\"145.03\" fill=\"#B7862B\" stroke=\"#1F2A24\" stroke-width=\"0\"/><text x=\"445.22\" y=\"184.97\" font-size=\"10\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\">180</text><rect x=\"56\" y=\"37\" width=\"10\" height=\"10\" fill=\"#2F6B4F\"/><text x=\"72\" y=\"42\" font-size=\"11\" text-anchor=\"start\" dominant-baseline=\"middle\" fill=\"#1F2A24\">2024</text><rect x=\"116\" y=\"37\" width=\"10\" height=\"10\" fill=\"#B7862B\"/><text x=\"132\" y=\"42\" font-size=\"11\" text-anchor=\"start\" dominant-baseline=\"middle\" fill=\"#1F2A24\">2025</text></svg>",
  "description": "A bar chart of 2024, 2025 across 3 categories: June, July, August. 2024: highest at July (300); 2025: highest at July (340). The values are in the table.",
  "table": {
   "caption": "Rainfall",
   "columns": [
    "Category",
    "2024",
    "2025"
   ],
   "rows": [
    [
     "June",
     "120",
     "90"
    ],
    [
     "July",
     "300",
     "340"
    ],
    [
     "August",
     "210",
     "180"
    ]
   ]
  },
  "ok": true,
  "parts": [
   {
    "part": "bar-1-1",
    "label": "2024, June: 120"
   },
   {
    "part": "bar-1-2",
    "label": "2024, July: 300"
   },
   {
    "part": "bar-1-3",
    "label": "2024, August: 210"
   },
   {
    "part": "bar-2-1",
    "label": "2025, June: 90"
   },
   {
    "part": "bar-2-2",
    "label": "2025, July: 340"
   },
   {
    "part": "bar-2-3",
    "label": "2025, August: 180"
   }
  ],
  "stepCount": 0,
  "steps": []
 },
 "line": {
  "kind": "figure",
  "type": "chart",
  "title": "Line chart",
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 520 380\" width=\"520\" height=\"380\" role=\"img\" aria-labelledby=\"fig-b969cb11bd-title fig-b969cb11bd-desc\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" id=\"fig-b969cb11bd\"><title id=\"fig-b969cb11bd-title\">Line chart</title><desc id=\"fig-b969cb11bd-desc\">A line chart of Sales across 4 categories: Mon, Tue, Wed, Thu. Sales: highest at Thu (7). The values are in the table.</desc><rect x=\"0\" y=\"0\" width=\"520\" height=\"380\" fill=\"#FFFFFF\"/><g stroke=\"#E3E5E0\"><line x1=\"56\" y1=\"338\" x2=\"504\" y2=\"338\"/><line x1=\"56\" y1=\"273.2\" x2=\"504\" y2=\"273.2\"/><line x1=\"56\" y1=\"208.4\" x2=\"504\" y2=\"208.4\"/><line x1=\"56\" y1=\"143.6\" x2=\"504\" y2=\"143.6\"/><line x1=\"56\" y1=\"78.8\" x2=\"504\" y2=\"78.8\"/><line x1=\"56\" y1=\"14\" x2=\"504\" y2=\"14\"/></g><text x=\"49\" y=\"338\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">2</text><text x=\"49\" y=\"273.2\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">3</text><text x=\"49\" y=\"208.4\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">4</text><text x=\"49\" y=\"143.6\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">5</text><text x=\"49\" y=\"78.8\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">6</text><text x=\"49\" y=\"14\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">7</text><line x1=\"56\" y1=\"14\" x2=\"56\" y2=\"338\" stroke=\"#3A4540\" stroke-width=\"1.4\"/><line x1=\"56\" y1=\"338\" x2=\"504\" y2=\"338\" stroke=\"#3A4540\" stroke-width=\"1.4\"/><text x=\"130.67\" y=\"352\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">Mon</text><text x=\"230.22\" y=\"352\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">Tue</text><text x=\"329.78\" y=\"352\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">Wed</text><text x=\"429.33\" y=\"352\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">Thu</text><g id=\"fig-b969cb11bd-series1\" data-part=\"series1\"><path d=\"M130.67,273.2L230.22,143.6L329.78,338L429.33,14\" fill=\"none\" stroke=\"#2F6B4F\" stroke-width=\"2.2\"/><circle id=\"fig-b969cb11bd-pt-1-1\" data-part=\"pt-1-1\" cx=\"130.67\" cy=\"273.2\" r=\"4\" fill=\"#2F6B4F\"/><circle id=\"fig-b969cb11bd-pt-1-2\" data-part=\"pt-1-2\" cx=\"230.22\" cy=\"143.6\" r=\"4\" fill=\"#2F6B4F\"/><circle id=\"fig-b969cb11bd-pt-1-3\" data-part=\"pt-1-3\" cx=\"329.78\" cy=\"338\" r=\"4\" fill=\"#2F6B4F\"/><circle id=\"fig-b969cb11bd-pt-1-4\" data-part=\"pt-1-4\" cx=\"429.33\" cy=\"14\" r=\"4\" fill=\"#2F6B4F\"/></g></svg>",
  "description": "A line chart of Sales across 4 categories: Mon, Tue, Wed, Thu. Sales: highest at Thu (7). The values are in the table.",
  "table": {
   "caption": "The chart's data",
   "columns": [
    "Category",
    "Sales"
   ],
   "rows": [
    [
     "Mon",
     "3"
    ],
    [
     "Tue",
     "5"
    ],
    [
     "Wed",
     "2"
    ],
    [
     "Thu",
     "7"
    ]
   ]
  },
  "ok": true,
  "parts": [
   {
    "part": "pt-1-1",
    "label": "Sales, Mon: 3"
   },
   {
    "part": "pt-1-2",
    "label": "Sales, Tue: 5"
   },
   {
    "part": "pt-1-3",
    "label": "Sales, Wed: 2"
   },
   {
    "part": "pt-1-4",
    "label": "Sales, Thu: 7"
   },
   {
    "part": "series1",
    "label": "Sales"
   }
  ],
  "stepCount": 0,
  "steps": []
 },
 "pie": {
  "kind": "figure",
  "type": "chart",
  "title": "Pie chart",
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 520 380\" width=\"520\" height=\"380\" role=\"img\" aria-labelledby=\"fig-1e9046797c-title fig-1e9046797c-desc\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" id=\"fig-1e9046797c\"><title id=\"fig-1e9046797c-title\">Pie chart</title><desc id=\"fig-1e9046797c-desc\">A pie chart of 3 parts making a total of 100: Rent 40%, Food 35%, Other 25%. The largest is Rent.</desc><rect x=\"0\" y=\"0\" width=\"520\" height=\"380\" fill=\"#FFFFFF\"/><path id=\"fig-1e9046797c-slice1\" data-part=\"slice1\" transform=\"translate(260 174)\" d=\"M0,-130A130,130,0,0,1,76.41,105.17L0,0Z\" fill=\"#2F6B4F\" stroke=\"#FFFFFF\" stroke-width=\"1.5\"/><text x=\"400.76\" y=\"128.27\" font-size=\"11\" text-anchor=\"start\" dominant-baseline=\"middle\" fill=\"#1F2A24\">Rent 40%</text><path id=\"fig-1e9046797c-slice2\" data-part=\"slice2\" transform=\"translate(260 174)\" d=\"M76.41,105.17A130,130,0,0,1,-130,0L0,0Z\" fill=\"#B7862B\" stroke=\"#FFFFFF\" stroke-width=\"1.5\"/><text x=\"192.81\" y=\"305.87\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#1F2A24\">Food 35%</text><path id=\"fig-1e9046797c-slice3\" data-part=\"slice3\" transform=\"translate(260 174)\" d=\"M-130,0A130,130,0,0,1,0,-130L0,0Z\" fill=\"#4F6D8A\" stroke=\"#FFFFFF\" stroke-width=\"1.5\"/><text x=\"155.35\" y=\"69.35\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#1F2A24\">Other 25%</text></svg>",
  "description": "A pie chart of 3 parts making a total of 100: Rent 40%, Food 35%, Other 25%. The largest is Rent.",
  "table": {
   "caption": "The chart's data",
   "columns": [
    "Part",
    "Value",
    "Share"
   ],
   "rows": [
    [
     "Rent",
     "40",
     "40%"
    ],
    [
     "Food",
     "35",
     "35%"
    ],
    [
     "Other",
     "25",
     "25%"
    ]
   ]
  },
  "ok": true,
  "parts": [
   {
    "part": "slice1",
    "label": "Rent: 40 (40%)"
   },
   {
    "part": "slice2",
    "label": "Food: 35 (35%)"
   },
   {
    "part": "slice3",
    "label": "Other: 25 (25%)"
   }
  ],
  "stepCount": 0,
  "steps": []
 },
 "histogram": {
  "kind": "figure",
  "type": "chart",
  "title": "Histogram",
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 520 380\" width=\"520\" height=\"380\" role=\"img\" aria-labelledby=\"fig-a0830522c5-title fig-a0830522c5-desc\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" id=\"fig-a0830522c5\"><title id=\"fig-a0830522c5-title\">Histogram</title><desc id=\"fig-a0830522c5-desc\">A histogram of 14 values of Marks in 3 groups from 0 to 30. The tallest group is 10 to 20, with 7.</desc><rect x=\"0\" y=\"0\" width=\"520\" height=\"380\" fill=\"#FFFFFF\"/><g stroke=\"#E3E5E0\"><line x1=\"56\" y1=\"322\" x2=\"504\" y2=\"322\"/><line x1=\"56\" y1=\"278\" x2=\"504\" y2=\"278\"/><line x1=\"56\" y1=\"234\" x2=\"504\" y2=\"234\"/><line x1=\"56\" y1=\"190\" x2=\"504\" y2=\"190\"/><line x1=\"56\" y1=\"146\" x2=\"504\" y2=\"146\"/><line x1=\"56\" y1=\"102\" x2=\"504\" y2=\"102\"/><line x1=\"56\" y1=\"58\" x2=\"504\" y2=\"58\"/><line x1=\"56\" y1=\"14\" x2=\"504\" y2=\"14\"/></g><text x=\"49\" y=\"322\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">0</text><text x=\"49\" y=\"278\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">1</text><text x=\"49\" y=\"234\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">2</text><text x=\"49\" y=\"190\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">3</text><text x=\"49\" y=\"146\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">4</text><text x=\"49\" y=\"102\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">5</text><text x=\"49\" y=\"58\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">6</text><text x=\"49\" y=\"14\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">7</text><line x1=\"56\" y1=\"14\" x2=\"56\" y2=\"322\" stroke=\"#3A4540\" stroke-width=\"1.4\"/><line x1=\"56\" y1=\"322\" x2=\"504\" y2=\"322\" stroke=\"#3A4540\" stroke-width=\"1.4\"/><g transform=\"translate(16 168) rotate(-90)\"><text x=\"0\" y=\"0\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\">Frequency</text></g><text x=\"56\" y=\"336\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">0</text><text x=\"205.33\" y=\"336\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">10</text><text x=\"354.67\" y=\"336\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">20</text><text x=\"504\" y=\"336\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">30</text><rect id=\"fig-a0830522c5-bin1\" data-part=\"bin1\" x=\"56\" y=\"190\" width=\"149.33\" height=\"132\" fill=\"#2F6B4F\" stroke=\"#FFFFFF\" stroke-width=\"1\"/><rect id=\"fig-a0830522c5-bin2\" data-part=\"bin2\" x=\"205.33\" y=\"14\" width=\"149.33\" height=\"308\" fill=\"#2F6B4F\" stroke=\"#FFFFFF\" stroke-width=\"1\"/><rect id=\"fig-a0830522c5-bin3\" data-part=\"bin3\" x=\"354.67\" y=\"146\" width=\"149.33\" height=\"176\" fill=\"#2F6B4F\" stroke=\"#FFFFFF\" stroke-width=\"1\"/><text x=\"280\" y=\"364\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\">Marks</text></svg>",
  "description": "A histogram of 14 values of Marks in 3 groups from 0 to 30. The tallest group is 10 to 20, with 7.",
  "table": {
   "caption": "The histogram's groups",
   "columns": [
    "From",
    "To",
    "Count"
   ],
   "rows": [
    [
     "0",
     "10",
     "3"
    ],
    [
     "10",
     "20",
     "7"
    ],
    [
     "20",
     "30",
     "4"
    ]
   ]
  },
  "ok": true,
  "parts": [
   {
    "part": "bin1",
    "label": "0 to 10: 3"
   },
   {
    "part": "bin2",
    "label": "10 to 20: 7"
   },
   {
    "part": "bin3",
    "label": "20 to 30: 4"
   }
  ],
  "stepCount": 0,
  "steps": []
 },
 "dot": {
  "kind": "figure",
  "type": "chart",
  "title": "Dot plot",
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 520 380\" width=\"520\" height=\"380\" role=\"img\" aria-labelledby=\"fig-3d3c1c10e7-title fig-3d3c1c10e7-desc\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" id=\"fig-3d3c1c10e7\"><title id=\"fig-3d3c1c10e7-title\">Dot plot</title><desc id=\"fig-3d3c1c10e7-desc\">A dot plot of 8 values, from 1 to 5. The most common value is 3, with 3 dots.</desc><rect x=\"0\" y=\"0\" width=\"520\" height=\"380\" fill=\"#FFFFFF\"/><line x1=\"30\" y1=\"338\" x2=\"490\" y2=\"338\" stroke=\"#3A4540\" stroke-width=\"1.4\"/><line x1=\"30\" y1=\"338\" x2=\"30\" y2=\"342\" stroke=\"#3A4540\"/><text x=\"30\" y=\"354\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">1</text><line x1=\"87.5\" y1=\"338\" x2=\"87.5\" y2=\"342\" stroke=\"#3A4540\"/><text x=\"87.5\" y=\"354\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">1.5</text><line x1=\"145\" y1=\"338\" x2=\"145\" y2=\"342\" stroke=\"#3A4540\"/><text x=\"145\" y=\"354\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">2</text><line x1=\"202.5\" y1=\"338\" x2=\"202.5\" y2=\"342\" stroke=\"#3A4540\"/><text x=\"202.5\" y=\"354\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">2.5</text><line x1=\"260\" y1=\"338\" x2=\"260\" y2=\"342\" stroke=\"#3A4540\"/><text x=\"260\" y=\"354\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">3</text><line x1=\"317.5\" y1=\"338\" x2=\"317.5\" y2=\"342\" stroke=\"#3A4540\"/><text x=\"317.5\" y=\"354\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">3.5</text><line x1=\"375\" y1=\"338\" x2=\"375\" y2=\"342\" stroke=\"#3A4540\"/><text x=\"375\" y=\"354\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">4</text><line x1=\"432.5\" y1=\"338\" x2=\"432.5\" y2=\"342\" stroke=\"#3A4540\"/><text x=\"432.5\" y=\"354\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">4.5</text><line x1=\"490\" y1=\"338\" x2=\"490\" y2=\"342\" stroke=\"#3A4540\"/><text x=\"490\" y=\"354\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">5</text><g id=\"fig-3d3c1c10e7-dots-1\" data-part=\"dots-1\"><circle cx=\"30\" cy=\"327\" r=\"9\" fill=\"#2F6B4F\"/></g><g id=\"fig-3d3c1c10e7-dots-2\" data-part=\"dots-2\"><circle cx=\"145\" cy=\"327\" r=\"9\" fill=\"#2F6B4F\"/><circle cx=\"145\" cy=\"308.1\" r=\"9\" fill=\"#2F6B4F\"/></g><g id=\"fig-3d3c1c10e7-dots-3\" data-part=\"dots-3\"><circle cx=\"260\" cy=\"327\" r=\"9\" fill=\"#2F6B4F\"/><circle cx=\"260\" cy=\"308.1\" r=\"9\" fill=\"#2F6B4F\"/><circle cx=\"260\" cy=\"289.2\" r=\"9\" fill=\"#2F6B4F\"/></g><g id=\"fig-3d3c1c10e7-dots-4\" data-part=\"dots-4\"><circle cx=\"375\" cy=\"327\" r=\"9\" fill=\"#2F6B4F\"/></g><g id=\"fig-3d3c1c10e7-dots-5\" data-part=\"dots-5\"><circle cx=\"490\" cy=\"327\" r=\"9\" fill=\"#2F6B4F\"/></g></svg>",
  "description": "A dot plot of 8 values, from 1 to 5. The most common value is 3, with 3 dots.",
  "table": {
   "caption": "The dot plot's values",
   "columns": [
    "Value",
    "How many"
   ],
   "rows": [
    [
     "1",
     "1"
    ],
    [
     "2",
     "2"
    ],
    [
     "3",
     "3"
    ],
    [
     "4",
     "1"
    ],
    [
     "5",
     "1"
    ]
   ]
  },
  "ok": true,
  "parts": [
   {
    "part": "dots-1",
    "label": "1: 1"
   },
   {
    "part": "dots-2",
    "label": "2: 2"
   },
   {
    "part": "dots-3",
    "label": "3: 3"
   },
   {
    "part": "dots-4",
    "label": "4: 1"
   },
   {
    "part": "dots-5",
    "label": "5: 1"
   }
  ],
  "stepCount": 0,
  "steps": []
 },
 "box": {
  "kind": "figure",
  "type": "chart",
  "title": "Box plot",
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 520 380\" width=\"520\" height=\"380\" role=\"img\" aria-labelledby=\"fig-67b8df4519-title fig-67b8df4519-desc\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" id=\"fig-67b8df4519\"><title id=\"fig-67b8df4519-title\">Box plot</title><desc id=\"fig-67b8df4519-desc\">A box plot of 1 group. Class A: lowest 20, lower quartile 35, median 48, upper quartile 60, highest 90.</desc><rect x=\"0\" y=\"0\" width=\"520\" height=\"380\" fill=\"#FFFFFF\"/><g stroke=\"#E3E5E0\"><line x1=\"56\" y1=\"338\" x2=\"504\" y2=\"338\"/><line x1=\"56\" y1=\"291.71\" x2=\"504\" y2=\"291.71\"/><line x1=\"56\" y1=\"245.43\" x2=\"504\" y2=\"245.43\"/><line x1=\"56\" y1=\"199.14\" x2=\"504\" y2=\"199.14\"/><line x1=\"56\" y1=\"152.86\" x2=\"504\" y2=\"152.86\"/><line x1=\"56\" y1=\"106.57\" x2=\"504\" y2=\"106.57\"/><line x1=\"56\" y1=\"60.29\" x2=\"504\" y2=\"60.29\"/><line x1=\"56\" y1=\"14\" x2=\"504\" y2=\"14\"/></g><text x=\"49\" y=\"338\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">20</text><text x=\"49\" y=\"291.71\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">30</text><text x=\"49\" y=\"245.43\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">40</text><text x=\"49\" y=\"199.14\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">50</text><text x=\"49\" y=\"152.86\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">60</text><text x=\"49\" y=\"106.57\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">70</text><text x=\"49\" y=\"60.29\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">80</text><text x=\"49\" y=\"14\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">90</text><line x1=\"56\" y1=\"14\" x2=\"56\" y2=\"338\" stroke=\"#3A4540\" stroke-width=\"1.4\"/><line x1=\"56\" y1=\"338\" x2=\"504\" y2=\"338\" stroke=\"#3A4540\" stroke-width=\"1.4\"/><g id=\"fig-67b8df4519-box1\" data-part=\"box1\" stroke=\"#1F2A24\" stroke-width=\"1.6\"><line x1=\"280\" y1=\"338\" x2=\"280\" y2=\"268.57\"/><line x1=\"280\" y1=\"152.86\" x2=\"280\" y2=\"14\"/><line x1=\"232\" y1=\"338\" x2=\"328\" y2=\"338\"/><line x1=\"232\" y1=\"14\" x2=\"328\" y2=\"14\"/><rect x=\"184\" y=\"152.86\" width=\"192\" height=\"115.71\" fill=\"#2F6B4F\" fill-opacity=\"0.25\"/><line x1=\"184\" y1=\"208.4\" x2=\"376\" y2=\"208.4\" stroke-width=\"3\"/></g><text x=\"280\" y=\"352\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">Class A</text></svg>",
  "description": "A box plot of 1 group. Class A: lowest 20, lower quartile 35, median 48, upper quartile 60, highest 90.",
  "table": {
   "caption": "The box plot's five-number summaries",
   "columns": [
    "Group",
    "Lowest",
    "Lower quartile",
    "Median",
    "Upper quartile",
    "Highest"
   ],
   "rows": [
    [
     "Class A",
     "20",
     "35",
     "48",
     "60",
     "90"
    ]
   ]
  },
  "ok": true,
  "parts": [
   {
    "part": "box1",
    "label": "Class A: median 48"
   }
  ],
  "stepCount": 0,
  "steps": []
 },
 "numberline": {
  "kind": "figure",
  "type": "numberline",
  "title": "Number line",
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 560 144\" width=\"560\" height=\"144\" role=\"img\" aria-labelledby=\"fig-f11ec28616-title fig-f11ec28616-desc\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" id=\"fig-f11ec28616\"><title id=\"fig-f11ec28616-title\">Number line</title><desc id=\"fig-f11ec28616-desc\">A number line from −5 to 5 with ticks every 1. It marks the interval −3 &lt; x ≤ 1; the ray x ≥ 3; point a at 2.</desc><defs><marker id=\"fig-f11ec28616-arrow\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\" markerUnits=\"userSpaceOnUse\"><path d=\"M0,0 L10,5 L0,10 Z\" fill=\"#3A4540\"/></marker><marker id=\"fig-f11ec28616-ray\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\" markerUnits=\"userSpaceOnUse\"><path d=\"M0,0 L10,5 L0,10 Z\" fill=\"#1F2A24\"/></marker></defs><rect x=\"0\" y=\"0\" width=\"560\" height=\"144\" fill=\"#FFFFFF\"/><line x1=\"16\" y1=\"78\" x2=\"544\" y2=\"78\" stroke=\"#3A4540\" stroke-width=\"1.6\" marker-start=\"url(#fig-f11ec28616-arrow)\" marker-end=\"url(#fig-f11ec28616-arrow)\"/><line x1=\"36\" y1=\"72\" x2=\"36\" y2=\"84\" stroke=\"#3A4540\" stroke-width=\"1.2\"/><text x=\"36\" y=\"98\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">−5</text><line x1=\"84.8\" y1=\"72\" x2=\"84.8\" y2=\"84\" stroke=\"#3A4540\" stroke-width=\"1.2\"/><text x=\"84.8\" y=\"98\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">−4</text><line x1=\"133.6\" y1=\"72\" x2=\"133.6\" y2=\"84\" stroke=\"#3A4540\" stroke-width=\"1.2\"/><text x=\"133.6\" y=\"98\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">−3</text><line x1=\"182.4\" y1=\"72\" x2=\"182.4\" y2=\"84\" stroke=\"#3A4540\" stroke-width=\"1.2\"/><text x=\"182.4\" y=\"98\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">−2</text><line x1=\"231.2\" y1=\"72\" x2=\"231.2\" y2=\"84\" stroke=\"#3A4540\" stroke-width=\"1.2\"/><text x=\"231.2\" y=\"98\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">−1</text><line x1=\"280\" y1=\"72\" x2=\"280\" y2=\"84\" stroke=\"#3A4540\" stroke-width=\"1.2\"/><text x=\"280\" y=\"98\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">0</text><line x1=\"328.8\" y1=\"72\" x2=\"328.8\" y2=\"84\" stroke=\"#3A4540\" stroke-width=\"1.2\"/><text x=\"328.8\" y=\"98\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">1</text><line x1=\"377.6\" y1=\"72\" x2=\"377.6\" y2=\"84\" stroke=\"#3A4540\" stroke-width=\"1.2\"/><text x=\"377.6\" y=\"98\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">2</text><line x1=\"426.4\" y1=\"72\" x2=\"426.4\" y2=\"84\" stroke=\"#3A4540\" stroke-width=\"1.2\"/><text x=\"426.4\" y=\"98\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">3</text><line x1=\"475.2\" y1=\"72\" x2=\"475.2\" y2=\"84\" stroke=\"#3A4540\" stroke-width=\"1.2\"/><text x=\"475.2\" y=\"98\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">4</text><line x1=\"524\" y1=\"72\" x2=\"524\" y2=\"84\" stroke=\"#3A4540\" stroke-width=\"1.2\"/><text x=\"524\" y=\"98\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">5</text><g id=\"fig-f11ec28616-i1\" data-part=\"i1\"><line x1=\"133.6\" y1=\"56\" x2=\"328.8\" y2=\"56\" stroke=\"#2F6B4F\" stroke-width=\"3.5\"/><circle cx=\"133.6\" cy=\"56\" r=\"5\" fill=\"#FFFFFF\" stroke=\"#2F6B4F\" stroke-width=\"2\"/><circle cx=\"328.8\" cy=\"56\" r=\"5\" fill=\"#2F6B4F\" stroke=\"#2F6B4F\" stroke-width=\"2\"/></g><g id=\"fig-f11ec28616-r1\" data-part=\"r1\"><line x1=\"426.4\" y1=\"34\" x2=\"540\" y2=\"34\" stroke=\"#B7862B\" stroke-width=\"3.5\" marker-end=\"url(#fig-f11ec28616-ray)\"/><circle cx=\"426.4\" cy=\"34\" r=\"5\" fill=\"#B7862B\" stroke=\"#B7862B\" stroke-width=\"2\"/></g><g id=\"fig-f11ec28616-p1\" data-part=\"p1\"><circle cx=\"377.6\" cy=\"78\" r=\"5.5\" fill=\"#2F6B4F\" stroke=\"#2F6B4F\" stroke-width=\"2\"/><text x=\"377.6\" y=\"114\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\" font-weight=\"600\">a</text></g></svg>",
  "description": "A number line from −5 to 5 with ticks every 1. It marks the interval −3 < x ≤ 1; the ray x ≥ 3; point a at 2.",
  "table": {
   "caption": "What the number line marks",
   "columns": [
    "Part",
    "Label",
    "Where"
   ],
   "rows": [
    [
     "Point",
     "a",
     "2"
    ],
    [
     "Interval",
     "",
     "−3 to 1 (open at −3, closed at 1)"
    ],
    [
     "Ray",
     "",
     "from 3 to the right (closed at 3)"
    ]
   ]
  },
  "ok": true,
  "parts": [
   {
    "part": "i1",
    "label": "−3 < x ≤ 1"
   },
   {
    "part": "r1",
    "label": "x ≥ 3"
   },
   {
    "part": "p1",
    "label": "a at 2"
   }
  ],
  "stepCount": 0,
  "steps": []
 },
 "geometry": {
  "kind": "figure",
  "type": "geometry",
  "title": "Geometry drawing",
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 449.14 400\" width=\"449.14\" height=\"400\" role=\"img\" aria-labelledby=\"fig-432012544f-title fig-432012544f-desc\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" id=\"fig-432012544f\"><title id=\"fig-432012544f-title\">Geometry drawing</title><desc id=\"fig-432012544f-desc\">A drawing on a frame from (−1, −1) to (7, 6). Points: A at (0, 0), B at (6, 0), C at (2, 5). It shows a shape with corners A, B, C; the angle x (BAC) of 68.2 degrees; the arrow W of length 2 pointing down.</desc><defs><clipPath id=\"fig-432012544f-clip\"><rect x=\"22\" y=\"22\" width=\"405.14\" height=\"356\"/></clipPath><marker id=\"fig-432012544f-vec\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\" markerUnits=\"userSpaceOnUse\"><path d=\"M0,0 L10,5 L0,10 Z\" fill=\"#2F6B4F\"/></marker><marker id=\"fig-432012544f-hl\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\" markerUnits=\"userSpaceOnUse\"><path d=\"M0,0 L10,5 L0,10 Z\" fill=\"#B7862B\"/></marker></defs><rect x=\"0\" y=\"0\" width=\"449.14\" height=\"400\" fill=\"#FFFFFF\"/><polygon id=\"fig-432012544f-tri\" data-part=\"tri\" points=\"77.14,322.86 372,322.86 175.43,77.14\" fill=\"#2F6B4F\" fill-opacity=\"0.06\" stroke=\"#1F2A24\" stroke-width=\"1.8\" stroke-linejoin=\"round\" clip-path=\"url(#fig-432012544f-clip)\"/><g id=\"fig-432012544f-atA\" data-part=\"atA\"><path d=\"M97.14,322.86 A20,20 0 0 0 84.57,304.29\" fill=\"none\" stroke=\"#2F6B4F\" stroke-width=\"1.8\"/></g><text x=\"105.3\" y=\"303.8\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#2F6B4F\" font-weight=\"600\">x</text><line id=\"fig-432012544f-W\" data-part=\"W\" x1=\"175.43\" y1=\"77.14\" x2=\"175.43\" y2=\"175.43\" stroke=\"#2F6B4F\" stroke-width=\"2.6\" marker-end=\"url(#fig-432012544f-vec)\"/><text x=\"175.43\" y=\"189.43\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#2F6B4F\" font-weight=\"600\">W</text><g id=\"fig-432012544f-A\" data-part=\"A\"><circle cx=\"77.14\" cy=\"322.86\" r=\"3.8\" fill=\"#1F2A24\"/><text x=\"84.14\" y=\"313.86\" font-size=\"13\" text-anchor=\"start\" dominant-baseline=\"middle\" fill=\"#1F2A24\" font-weight=\"600\">A</text></g><g id=\"fig-432012544f-B\" data-part=\"B\"><circle cx=\"372\" cy=\"322.86\" r=\"3.8\" fill=\"#1F2A24\"/><text x=\"379\" y=\"313.86\" font-size=\"13\" text-anchor=\"start\" dominant-baseline=\"middle\" fill=\"#1F2A24\" font-weight=\"600\">B</text></g><g id=\"fig-432012544f-C\" data-part=\"C\"><circle cx=\"175.43\" cy=\"77.14\" r=\"3.8\" fill=\"#1F2A24\"/><text x=\"182.43\" y=\"68.14\" font-size=\"13\" text-anchor=\"start\" dominant-baseline=\"middle\" fill=\"#1F2A24\" font-weight=\"600\">C</text></g></svg>",
  "description": "A drawing on a frame from (−1, −1) to (7, 6). Points: A at (0, 0), B at (6, 0), C at (2, 5). It shows a shape with corners A, B, C; the angle x (BAC) of 68.2 degrees; the arrow W of length 2 pointing down.",
  "table": {
   "caption": "What the drawing shows",
   "columns": [
    "Part",
    "Name",
    "Value"
   ],
   "rows": [
    [
     "Point",
     "A",
     "(0, 0)"
    ],
    [
     "Point",
     "B",
     "(6, 0)"
    ],
    [
     "Point",
     "C",
     "(2, 5)"
    ],
    [
     "Arrow",
     "W",
     "0 across, −2 up (length 2)"
    ]
   ]
  },
  "ok": true,
  "parts": [
   {
    "part": "tri",
    "label": "shape ABC"
   },
   {
    "part": "atA",
    "label": "x"
   },
   {
    "part": "W",
    "label": "W"
   },
   {
    "part": "A",
    "label": "A"
   },
   {
    "part": "B",
    "label": "B"
   },
   {
    "part": "C",
    "label": "C"
   }
  ],
  "stepCount": 1,
  "steps": [
   {
    "caption": "The angle at A.",
    "highlight": [
     "atA"
    ],
    "frames": null,
    "index": 1
   }
  ]
 },
 "optics": {
  "kind": "figure",
  "type": "geometry",
  "title": "Convex lens",
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 520 271.6\" width=\"520\" height=\"271.6\" role=\"img\" aria-labelledby=\"fig-ff27deb20d-title fig-ff27deb20d-desc\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" id=\"fig-ff27deb20d\"><title id=\"fig-ff27deb20d-title\">Convex lens</title><desc id=\"fig-ff27deb20d-desc\">A ray diagram for a convex lens of focal length 10. The object stands 25 from it and is 4 tall. The image is real, inverted and smaller, 16.6667 away on the other side, 2.6667 tall.</desc><defs><clipPath id=\"fig-ff27deb20d-clip\"><rect x=\"22\" y=\"52\" width=\"476\" height=\"197.6\"/></clipPath><marker id=\"fig-ff27deb20d-vec\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\" markerUnits=\"userSpaceOnUse\"><path d=\"M0,0 L10,5 L0,10 Z\" fill=\"#2F6B4F\"/></marker><marker id=\"fig-ff27deb20d-hl\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\" markerUnits=\"userSpaceOnUse\"><path d=\"M0,0 L10,5 L0,10 Z\" fill=\"#B7862B\"/></marker></defs><rect x=\"0\" y=\"0\" width=\"520\" height=\"271.6\" fill=\"#FFFFFF\"/><text x=\"260\" y=\"20\" font-size=\"15\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\" font-weight=\"600\">Convex lens</text><line id=\"fig-ff27deb20d-axis\" data-part=\"axis\" x1=\"28\" y1=\"150.8\" x2=\"492\" y2=\"150.8\" stroke=\"#585C63\" stroke-width=\"1.2\" stroke-dasharray=\"8 4\"/><g id=\"fig-ff27deb20d-element\" data-part=\"element\"><line x1=\"260\" y1=\"110.71\" x2=\"260\" y2=\"190.89\" stroke=\"#1F2A24\" stroke-width=\"2.4\"/><path d=\"M260,110.71 Q274,150.8 260,190.89 Q246,150.8 260,110.71 Z\" fill=\"#2F6B4F\" fill-opacity=\"0.12\" stroke=\"#1F2A24\" stroke-width=\"1.2\"/></g><circle cx=\"185.76\" cy=\"150.8\" r=\"2.6\" fill=\"#1F2A24\"/><text x=\"185.76\" y=\"165.8\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">F</text><circle cx=\"334.24\" cy=\"150.8\" r=\"2.6\" fill=\"#1F2A24\"/><text x=\"334.24\" y=\"165.8\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">F</text><circle cx=\"111.52\" cy=\"150.8\" r=\"2.6\" fill=\"#1F2A24\"/><text x=\"111.52\" y=\"165.8\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">2F</text><circle cx=\"408.48\" cy=\"150.8\" r=\"2.6\" fill=\"#1F2A24\"/><text x=\"408.48\" y=\"165.8\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">2F</text><line id=\"fig-ff27deb20d-object\" data-part=\"object\" x1=\"74.4\" y1=\"150.8\" x2=\"74.4\" y2=\"121.1\" stroke=\"#2F6B4F\" stroke-width=\"3\" marker-end=\"url(#fig-ff27deb20d-vec)\"/><text x=\"74.4\" y=\"109.1\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\">Object</text><g id=\"fig-ff27deb20d-ray1\" data-part=\"ray1\" clip-path=\"url(#fig-ff27deb20d-clip)\"><line x1=\"74.4\" y1=\"121.1\" x2=\"260\" y2=\"121.1\" stroke=\"#B7862B\" stroke-width=\"1.8\"/><line x1=\"260\" y1=\"121.1\" x2=\"1466.28\" y2=\"603.61\" stroke=\"#B7862B\" stroke-width=\"1.8\"/></g><g id=\"fig-ff27deb20d-ray2\" data-part=\"ray2\" clip-path=\"url(#fig-ff27deb20d-clip)\"><line x1=\"74.4\" y1=\"121.1\" x2=\"260\" y2=\"150.8\" stroke=\"#4F6D8A\" stroke-width=\"1.8\"/><line x1=\"260\" y1=\"150.8\" x2=\"1542.88\" y2=\"356.06\" stroke=\"#4F6D8A\" stroke-width=\"1.8\"/></g><line id=\"fig-ff27deb20d-image\" data-part=\"image\" x1=\"383.73\" y1=\"150.8\" x2=\"383.73\" y2=\"170.6\" stroke=\"#4F6D8A\" stroke-width=\"3\" marker-end=\"url(#fig-ff27deb20d-vec)\" clip-path=\"url(#fig-ff27deb20d-clip)\"/><text x=\"383.73\" y=\"184.6\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\">Image</text></svg>",
  "description": "A ray diagram for a convex lens of focal length 10. The object stands 25 from it and is 4 tall. The image is real, inverted and smaller, 16.6667 away on the other side, 2.6667 tall.",
  "table": {
   "caption": "What the drawing shows",
   "columns": [
    "Part",
    "Name",
    "Value"
   ],
   "rows": [
    [
     "Focal length",
     "",
     "10"
    ],
    [
     "Object distance",
     "",
     "25"
    ],
    [
     "Object height",
     "",
     "4"
    ],
    [
     "Image distance",
     "",
     "16.6667"
    ],
    [
     "Image height",
     "",
     "−2.6667"
    ],
    [
     "Image",
     "",
     "real"
    ]
   ]
  },
  "ok": true,
  "parts": [
   {
    "part": "ray1",
    "label": "the ray parallel to the axis"
   },
   {
    "part": "ray2",
    "label": "the ray through the centre"
   },
   {
    "part": "element",
    "label": "convex lens"
   },
   {
    "part": "object",
    "label": "the object"
   },
   {
    "part": "image",
    "label": "the image"
   },
   {
    "part": "axis",
    "label": "the principal axis"
   }
  ],
  "stepCount": 0,
  "steps": []
 },
 "timeline": {
  "kind": "figure",
  "type": "timeline",
  "title": "Towards independence",
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 640 162\" width=\"640\" height=\"162\" role=\"img\" aria-labelledby=\"fig-1f21d8dd30-title fig-1f21d8dd30-desc\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" id=\"fig-1f21d8dd30\"><title id=\"fig-1f21d8dd30-title\">Towards independence</title><desc id=\"fig-1f21d8dd30-desc\">A timeline from 1919 to 15 August 1947 with 4 events, in order: 1919, Jallianwala Bagh; 1920, Non-cooperation begins; 1930, Salt March; 15 August 1947, Independence.</desc><rect x=\"0\" y=\"0\" width=\"640\" height=\"162\" fill=\"#FFFFFF\"/><text x=\"320\" y=\"20\" font-size=\"15\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\" font-weight=\"600\">Towards independence</text><line x1=\"24\" y1=\"92\" x2=\"616\" y2=\"92\" stroke=\"#3A4540\" stroke-width=\"2\"/><g id=\"fig-1f21d8dd30-e1\" data-part=\"e1\"><line x1=\"40\" y1=\"92\" x2=\"53.1\" y2=\"78\" stroke=\"#585C63\" stroke-width=\"1\"/><circle cx=\"40\" cy=\"92\" r=\"4.5\" fill=\"#2F6B4F\"/><text x=\"53.1\" y=\"56\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#2F6B4F\" font-weight=\"700\">1919</text><text x=\"53.1\" y=\"69\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\">Jallianwala Bagh</text></g><g id=\"fig-1f21d8dd30-e2\" data-part=\"e2\"><line x1=\"59.57\" y1=\"92\" x2=\"59.57\" y2=\"108\" stroke=\"#585C63\" stroke-width=\"1\"/><circle cx=\"59.57\" cy=\"92\" r=\"4.5\" fill=\"#2F6B4F\"/><text x=\"59.57\" y=\"114\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#2F6B4F\" font-weight=\"700\">1920</text><text x=\"59.57\" y=\"127.13\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\">Non-cooperation</text><text x=\"59.57\" y=\"140.88\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\">begins</text></g><g id=\"fig-1f21d8dd30-e3\" data-part=\"e3\"><line x1=\"255.22\" y1=\"92\" x2=\"255.22\" y2=\"78\" stroke=\"#585C63\" stroke-width=\"1\"/><circle cx=\"255.22\" cy=\"92\" r=\"4.5\" fill=\"#2F6B4F\"/><text x=\"255.22\" y=\"56\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#2F6B4F\" font-weight=\"700\">1930</text><text x=\"255.22\" y=\"69\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\">Salt March</text></g><g id=\"fig-1f21d8dd30-e4\" data-part=\"e4\"><line x1=\"600\" y1=\"92\" x2=\"592.18\" y2=\"108\" stroke=\"#585C63\" stroke-width=\"1\"/><circle cx=\"600\" cy=\"92\" r=\"4.5\" fill=\"#2F6B4F\"/><text x=\"592.18\" y=\"114\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#2F6B4F\" font-weight=\"700\">15 August 1947</text><text x=\"592.18\" y=\"127\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\">Independence</text></g></svg>",
  "description": "A timeline from 1919 to 15 August 1947 with 4 events, in order: 1919, Jallianwala Bagh; 1920, Non-cooperation begins; 1930, Salt March; 15 August 1947, Independence.",
  "table": {
   "caption": "The events in order",
   "columns": [
    "Date",
    "Event"
   ],
   "rows": [
    [
     "1919",
     "Jallianwala Bagh"
    ],
    [
     "1920",
     "Non-cooperation begins"
    ],
    [
     "1930",
     "Salt March"
    ],
    [
     "15 August 1947",
     "Independence"
    ]
   ]
  },
  "ok": true,
  "parts": [
   {
    "part": "e1",
    "label": "1919: Jallianwala Bagh"
   },
   {
    "part": "e2",
    "label": "1920: Non-cooperation begins"
   },
   {
    "part": "e3",
    "label": "1930: Salt March"
   },
   {
    "part": "e4",
    "label": "15 August 1947: Independence"
   }
  ],
  "stepCount": 0,
  "steps": []
 },
 "diagram": {
  "kind": "figure",
  "type": "diagram",
  "title": "Factorial",
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 224 232\" width=\"224\" height=\"232\" role=\"img\" aria-labelledby=\"fig-e76757fedf-title fig-e76757fedf-desc\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" id=\"fig-e76757fedf\"><title id=\"fig-e76757fedf-title\">Factorial</title><desc id=\"fig-e76757fedf-desc\">A flowchart with 4 boxes: Start; Is n &gt; 1?; n × fact(n - 1); Return 1. Start leads to Is n &gt; 1?; Is n &gt; 1? leads to n × fact(n - 1) (yes); Is n &gt; 1? leads to Return 1 (no).</desc><rect x=\"0\" y=\"0\" width=\"224\" height=\"232\" fill=\"#FFFFFF\"/><g id=\"fig-e76757fedf-graph\" class=\"graph\" transform=\"scale(1 1) rotate(0) translate(14.4 217.18)\"><g id=\"fig-e76757fedf-start\" class=\"node\" data-part=\"start\"><ellipse fill=\"#ffffff\" stroke=\"#1f2a24\" stroke-width=\"1.4\" cx=\"107.13\" cy=\"-182.8\" rx=\"30.1\" ry=\"19.98\"/><text text-anchor=\"middle\" x=\"107.13\" y=\"-179.2\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" font-size=\"12.00\" fill=\"#1f2a24\">Start</text></g><g id=\"fig-e76757fedf-test\" class=\"node\" data-part=\"test\"><polygon fill=\"#ffffff\" stroke=\"#1f2a24\" stroke-width=\"1.4\" points=\"107.13,-129.82 43.01,-101.71 107.13,-73.59 171.24,-101.71 107.13,-129.82\"/><text text-anchor=\"middle\" x=\"107.13\" y=\"-98.11\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" font-size=\"12.00\" fill=\"#1f2a24\">Is n &gt; 1?</text></g><g id=\"fig-e76757fedf-e1\" class=\"edge\" data-part=\"e1\"><path fill=\"none\" stroke=\"#3a4540\" stroke-width=\"1.3\" d=\"M107.13,-162.25C107.13,-155.57 107.13,-147.86 107.13,-140.25\"/><polygon fill=\"#3a4540\" stroke=\"#3a4540\" stroke-width=\"1.3\" points=\"109.93,-140.36 107.13,-132.36 104.33,-140.36 109.93,-140.36\"/></g><g id=\"fig-e76757fedf-mul\" class=\"node\" data-part=\"mul\"><path fill=\"#ffffff\" stroke=\"#1f2a24\" stroke-width=\"1.4\" d=\"M94.39,-29.59C94.39,-29.59 9.86,-29.59 9.86,-29.59 4.93,-29.59 0,-24.66 0,-19.73 0,-19.73 0,-9.86 0,-9.86 0,-4.93 4.93,0 9.86,0 9.86,0 94.39,0 94.39,0 99.32,0 104.26,-4.93 104.26,-9.86 104.26,-9.86 104.26,-19.73 104.26,-19.73 104.26,-24.66 99.32,-29.59 94.39,-29.59\"/><text text-anchor=\"middle\" x=\"52.13\" y=\"-11.2\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" font-size=\"12.00\" fill=\"#1f2a24\">n × fact(n &#45; 1)</text></g><g id=\"fig-e76757fedf-yes\" class=\"edge\" data-part=\"yes\"><path fill=\"none\" stroke=\"#3a4540\" stroke-width=\"1.3\" d=\"M93.25,-79.28C85.18,-66.83 75.02,-51.14 66.82,-38.48\"/><polygon fill=\"#3a4540\" stroke=\"#3a4540\" stroke-width=\"1.3\" points=\"69.27,-37.12 62.57,-31.92 64.57,-40.16 69.27,-37.12\"/><text text-anchor=\"middle\" x=\"84.64\" y=\"-48.59\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" font-size=\"10.00\" fill=\"#1f2a24\">yes</text></g><g id=\"fig-e76757fedf-one\" class=\"node\" data-part=\"one\"><path fill=\"#ffffff\" stroke=\"#1f2a24\" stroke-width=\"1.4\" d=\"M185.24,-29.59C185.24,-29.59 139.02,-29.59 139.02,-29.59 134.08,-29.59 129.15,-24.66 129.15,-19.73 129.15,-19.73 129.15,-9.86 129.15,-9.86 129.15,-4.93 134.08,0 139.02,0 139.02,0 185.24,0 185.24,0 190.17,0 195.1,-4.93 195.1,-9.86 195.1,-9.86 195.1,-19.73 195.1,-19.73 195.1,-24.66 190.17,-29.59 185.24,-29.59\"/><text text-anchor=\"middle\" x=\"162.13\" y=\"-11.2\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" font-size=\"12.00\" fill=\"#1f2a24\">Return 1</text></g><g id=\"fig-e76757fedf-no\" class=\"edge\" data-part=\"no\"><path fill=\"none\" stroke=\"#3a4540\" stroke-width=\"1.3\" d=\"M121.01,-79.28C129.07,-66.83 139.23,-51.14 147.44,-38.48\"/><polygon fill=\"#3a4540\" stroke=\"#3a4540\" stroke-width=\"1.3\" points=\"149.68,-40.16 151.68,-31.92 144.98,-37.12 149.68,-40.16\"/><text text-anchor=\"middle\" x=\"147.77\" y=\"-48.59\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" font-size=\"10.00\" fill=\"#1f2a24\">no</text></g></g></svg>",
  "description": "A flowchart with 4 boxes: Start; Is n > 1?; n × fact(n - 1); Return 1. Start leads to Is n > 1?; Is n > 1? leads to n × fact(n - 1) (yes); Is n > 1? leads to Return 1 (no).",
  "table": {
   "caption": "Each box and what it leads to",
   "columns": [
    "Box",
    "Leads to or linked with"
   ],
   "rows": [
    [
     "Start",
     "Is n > 1?"
    ],
    [
     "Is n > 1?",
     "n × fact(n - 1) (yes); Return 1 (no)"
    ],
    [
     "n × fact(n - 1)",
     "(nothing)"
    ],
    [
     "Return 1",
     "(nothing)"
    ]
   ]
  },
  "ok": true,
  "parts": [
   {
    "part": "start",
    "label": "Start"
   },
   {
    "part": "test",
    "label": "Is n > 1?"
   },
   {
    "part": "mul",
    "label": "n × fact(n - 1)"
   },
   {
    "part": "one",
    "label": "Return 1"
   },
   {
    "part": "e1",
    "label": "Start to Is n > 1?"
   },
   {
    "part": "yes",
    "label": "Is n > 1? to n × fact(n - 1) (yes)"
   },
   {
    "part": "no",
    "label": "Is n > 1? to Return 1 (no)"
   }
  ],
  "stepCount": 2,
  "steps": [
   {
    "caption": "Check the base case first.",
    "highlight": [
     "test"
    ],
    "frames": null,
    "index": 1
   },
   {
    "caption": "n is 1, so return 1.",
    "highlight": [
     "no",
     "one"
    ],
    "frames": null,
    "index": 2
   }
  ]
 },
 "molecule": {
  "kind": "figure",
  "type": "molecule",
  "title": "Ethanol",
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 380 260\" width=\"380\" height=\"260\" role=\"img\" aria-labelledby=\"fig-0ab22425f6-title fig-0ab22425f6-desc\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" id=\"fig-0ab22425f6\"><title id=\"fig-0ab22425f6-title\">Ethanol</title><desc id=\"fig-0ab22425f6-desc\">The structure of Ethanol, a molecule with formula C2H6O (written as SMILES CCO). It has 3 atoms besides its hydrogens.</desc><rect x=\"0\" y=\"0\" width=\"380\" height=\"260\" fill=\"#FFFFFF\"/><g id=\"fig-0ab22425f6-bond-1\" data-part=\"bond-1\"><path d=\"M 31.0,162.8 L 170.2,82.4\" fill=\"none\" stroke=\"#000000\" stroke-width=\"2\" stroke-linecap=\"round\"/></g><g id=\"fig-0ab22425f6-bond-2\" data-part=\"bond-2\"><path d=\"M 170.2,82.4 L 230.7,117.3\" fill=\"none\" stroke=\"#000000\" stroke-width=\"2\" stroke-linecap=\"round\"/><path d=\"M 230.7,117.3 L 291.1,152.2\" fill=\"none\" stroke=\"#FF0000\" stroke-width=\"2\" stroke-linecap=\"round\"/></g><g><path d=\"M 163.3,86.5 L 170.2,82.4 L 173.2,84.2\" fill=\"none\" stroke=\"#000000\" stroke-width=\"2\" stroke-linecap=\"round\"/></g><g id=\"fig-0ab22425f6-atom-3\" data-part=\"atom-3\"><path d=\"M 296.4 162.9 Q 296.4 156.1, 299.8 152.3 Q 303.1 148.5, 309.4 148.5 Q 315.7 148.5, 319.1 152.3 Q 322.4 156.1, 322.4 162.9 Q 322.4 169.8, 319.0 173.7 Q 315.6 177.6, 309.4 177.6 Q 303.2 177.6, 299.8 173.7 Q 296.4 169.8, 296.4 162.9 M 309.4 174.4 Q 313.7 174.4, 316.1 171.5 Q 318.4 168.6, 318.4 162.9 Q 318.4 157.3, 316.1 154.5 Q 313.7 151.7, 309.4 151.7 Q 305.1 151.7, 302.7 154.5 Q 300.4 157.3, 300.4 162.9 Q 300.4 168.6, 302.7 171.5 Q 305.1 174.4, 309.4 174.4\" fill=\"#FF0000\" stroke=\"none\"/><path d=\"M 326.8 148.8 L 330.7 148.8 L 330.7 160.8 L 345.1 160.8 L 345.1 148.8 L 349.0 148.8 L 349.0 177.1 L 345.1 177.1 L 345.1 164.0 L 330.7 164.0 L 330.7 177.1 L 326.8 177.1 L 326.8 148.8\" fill=\"#FF0000\" stroke=\"none\"/></g></svg>",
  "description": "The structure of Ethanol, a molecule with formula C2H6O (written as SMILES CCO). It has 3 atoms besides its hydrogens.",
  "table": {
   "caption": "Atoms in Ethanol (formula C2H6O)",
   "columns": [
    "Element",
    "Count"
   ],
   "rows": [
    [
     "C",
     "2"
    ],
    [
     "H",
     "6"
    ],
    [
     "O",
     "1"
    ]
   ]
  },
  "ok": true,
  "parts": [
   {
    "part": "bond-1",
    "label": "bond 1"
   },
   {
    "part": "bond-2",
    "label": "bond 2"
   },
   {
    "part": "atom-3",
    "label": "atom 3 (O)"
   }
  ],
  "stepCount": 0,
  "steps": [],
  "formula": "C2H6O"
 },
 "pattern": {
  "kind": "figure",
  "type": "pattern",
  "title": "Pattern",
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 396 106\" width=\"396\" height=\"106\" role=\"img\" aria-labelledby=\"fig-d79237385e-title fig-d79237385e-desc\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" id=\"fig-d79237385e\"><title id=\"fig-d79237385e-title\">Pattern</title><desc id=\"fig-d79237385e-desc\">A pattern of 5 items in a row: 1, a medium green solid triangle; 2, a medium green outline square; 3, 2 medium green solid triangles; 4, 2 medium green outline squares; 5, blank, to work out. The blank is at position 5.</desc><rect x=\"0\" y=\"0\" width=\"396\" height=\"106\" fill=\"#FFFFFF\"/><g id=\"fig-d79237385e-item-1\" data-part=\"item-1\"><rect x=\"12\" y=\"12\" width=\"68\" height=\"68\" rx=\"10\" fill=\"#FFFFFF\" stroke=\"#D5D8D2\" stroke-width=\"1.2\"/><polygon points=\"46,30.7 61.46,57.47 30.54,57.48\" fill=\"#2F6B4F\" stroke=\"#2F6B4F\" stroke-width=\"1.5\"/></g><text x=\"46\" y=\"92\" font-size=\"10\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">1</text><g id=\"fig-d79237385e-item-2\" data-part=\"item-2\"><rect x=\"88\" y=\"12\" width=\"68\" height=\"68\" rx=\"10\" fill=\"#FFFFFF\" stroke=\"#D5D8D2\" stroke-width=\"1.2\"/><rect x=\"107.55\" y=\"31.55\" width=\"28.9\" height=\"28.9\" fill=\"#FFFFFF\" stroke=\"#2F6B4F\" stroke-width=\"2.4\"/></g><text x=\"122\" y=\"92\" font-size=\"10\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">2</text><g id=\"fig-d79237385e-item-3\" data-part=\"item-3\"><rect x=\"164\" y=\"12\" width=\"68\" height=\"68\" rx=\"10\" fill=\"#FFFFFF\" stroke=\"#D5D8D2\" stroke-width=\"1.2\"/><polygon points=\"183.5,34.65 194.97,54.51 172.03,54.51\" fill=\"#2F6B4F\" stroke=\"#2F6B4F\" stroke-width=\"1.5\"/><polygon points=\"212.5,34.65 223.97,54.51 201.03,54.51\" fill=\"#2F6B4F\" stroke=\"#2F6B4F\" stroke-width=\"1.5\"/></g><text x=\"198\" y=\"92\" font-size=\"10\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">3</text><g id=\"fig-d79237385e-item-4\" data-part=\"item-4\"><rect x=\"240\" y=\"12\" width=\"68\" height=\"68\" rx=\"10\" fill=\"#FFFFFF\" stroke=\"#D5D8D2\" stroke-width=\"1.2\"/><rect x=\"248.78\" y=\"35.28\" width=\"21.43\" height=\"21.43\" fill=\"#FFFFFF\" stroke=\"#2F6B4F\" stroke-width=\"2.4\"/><rect x=\"277.78\" y=\"35.28\" width=\"21.43\" height=\"21.43\" fill=\"#FFFFFF\" stroke=\"#2F6B4F\" stroke-width=\"2.4\"/></g><text x=\"274\" y=\"92\" font-size=\"10\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">4</text><g id=\"fig-d79237385e-item-5\" data-part=\"item-5\"><rect x=\"316\" y=\"12\" width=\"68\" height=\"68\" rx=\"10\" fill=\"#FFFFFF\" stroke=\"#D5D8D2\" stroke-width=\"1.2\" stroke-dasharray=\"6 4\"/><text x=\"350\" y=\"46\" font-size=\"28\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\" font-weight=\"700\">?</text></g><text x=\"350\" y=\"92\" font-size=\"10\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">5</text></svg>",
  "description": "A pattern of 5 items in a row: 1, a medium green solid triangle; 2, a medium green outline square; 3, 2 medium green solid triangles; 4, 2 medium green outline squares; 5, blank, to work out. The blank is at position 5.",
  "table": {
   "caption": "The pattern, item by item",
   "columns": [
    "Position",
    "Item"
   ],
   "rows": [
    [
     "1",
     "a medium green solid triangle"
    ],
    [
     "2",
     "a medium green outline square"
    ],
    [
     "3",
     "2 medium green solid triangles"
    ],
    [
     "4",
     "2 medium green outline squares"
    ],
    [
     "5",
     "Blank"
    ]
   ]
  },
  "ok": true,
  "parts": [
   {
    "part": "item-1",
    "label": "item 1: a medium green solid triangle"
   },
   {
    "part": "item-2",
    "label": "item 2: a medium green outline square"
   },
   {
    "part": "item-3",
    "label": "item 3: 2 medium green solid triangles"
   },
   {
    "part": "item-4",
    "label": "item 4: 2 medium green outline squares"
   },
   {
    "part": "item-5",
    "label": "item 5: the blank"
   }
  ],
  "stepCount": 0,
  "steps": []
 },
 "stack": {
  "kind": "figure",
  "type": "stack",
  "title": "fact(3)",
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 340 222\" width=\"340\" height=\"222\" role=\"img\" aria-labelledby=\"fig-77f7d57295-title fig-77f7d57295-desc\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" id=\"fig-77f7d57295\"><title id=\"fig-77f7d57295-title\">fact(3)</title><desc id=\"fig-77f7d57295-desc\">A stack of 1 frame, bottom to top: main. The top frame is main.</desc><rect x=\"0\" y=\"0\" width=\"340\" height=\"222\" fill=\"#FFFFFF\"/><text x=\"170\" y=\"20\" font-size=\"15\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\" font-weight=\"600\">fact(3)</text><polyline points=\"40,36 40,196 300,196 300,36\" fill=\"none\" stroke=\"#3A4540\" stroke-width=\"2\"/><g id=\"fig-77f7d57295-main\" data-part=\"main\"><rect x=\"48\" y=\"142\" width=\"244\" height=\"46\" rx=\"8\" fill=\"#2F6B4F\" fill-opacity=\"0.9\" stroke=\"#2F6B4F\" stroke-width=\"1.6\"/><text x=\"170\" y=\"165\" font-size=\"14\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#FFFFFF\" font-weight=\"700\">main</text></g><text x=\"170\" y=\"212\" font-size=\"10\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">Bottom of the stack</text></svg>",
  "description": "A stack of 1 frame, bottom to top: main. The top frame is main.",
  "table": {
   "caption": "The stack, bottom to top",
   "columns": [
    "Position",
    "Frame",
    "Note"
   ],
   "rows": [
    [
     "1",
     "main",
     ""
    ]
   ]
  },
  "ok": true,
  "parts": [
   {
    "part": "main",
    "label": "main"
   }
  ],
  "stepCount": 3,
  "steps": [
   {
    "caption": "main calls fact(3).",
    "highlight": null,
    "frames": [
     {
      "id": "main",
      "label": "main",
      "note": ""
     },
     {
      "id": "f3",
      "label": "fact(3)",
      "note": "n = 3"
     }
    ],
    "index": 1
   },
   {
    "caption": "fact(3) needs fact(2), so it waits.",
    "highlight": null,
    "frames": [
     {
      "id": "main",
      "label": "main",
      "note": ""
     },
     {
      "id": "f3",
      "label": "fact(3)",
      "note": ""
     },
     {
      "id": "f2",
      "label": "fact(2)",
      "note": "n = 2"
     }
    ],
    "index": 2
   },
   {
    "caption": "fact(2) returns 2 and is popped.",
    "highlight": null,
    "frames": [
     {
      "id": "main",
      "label": "main",
      "note": ""
     },
     {
      "id": "f3",
      "label": "fact(3)",
      "note": "returns 6"
     }
    ],
    "index": 3
   }
  ]
 },
 "devanagari": {
  "kind": "figure",
  "type": "diagram",
  "title": "Mind map",
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 202 165\" width=\"202\" height=\"165\" role=\"img\" aria-labelledby=\"fig-78ffd352a6-title fig-78ffd352a6-desc\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" id=\"fig-78ffd352a6\"><title id=\"fig-78ffd352a6-title\">Mind map</title><desc id=\"fig-78ffd352a6-desc\">A mind map with 3 boxes: प्रकाश संश्लेषण; सूर्यप्रकाश; पाणी आणि कार्बन डायऑक्साइड. प्रकाश संश्लेषण is linked to सूर्यप्रकाश; प्रकाश संश्लेषण is linked to पाणी आणि कार्बन डायऑक्साइड.</desc><rect x=\"0\" y=\"0\" width=\"202\" height=\"165\" fill=\"#FFFFFF\"/><g id=\"fig-78ffd352a6-graph\" class=\"graph\" transform=\"scale(1 1) rotate(0) translate(14.4 150.28)\"><g id=\"fig-78ffd352a6-root\" class=\"node\" data-part=\"root\"><ellipse fill=\"#ffffff\" stroke=\"#1f2a24\" stroke-width=\"1.4\" cx=\"86.47\" cy=\"-67.94\" rx=\"51.23\" ry=\"19.98\"/><text text-anchor=\"middle\" x=\"86.47\" y=\"-64.34\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" font-size=\"12.00\" fill=\"#1f2a24\">प्रकाश संश्लेषण</text></g><g id=\"fig-78ffd352a6-a\" class=\"node\" data-part=\"a\"><ellipse fill=\"#ffffff\" stroke=\"#1f2a24\" stroke-width=\"1.4\" cx=\"86.47\" cy=\"-115.9\" rx=\"38.74\" ry=\"19.98\"/><text text-anchor=\"middle\" x=\"86.47\" y=\"-112.3\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" font-size=\"12.00\" fill=\"#1f2a24\">सूर्यप्रकाश</text></g><g id=\"fig-78ffd352a6-e1\" class=\"edge\" data-part=\"e1\"><path fill=\"none\" stroke=\"#3a4540\" stroke-width=\"1.3\" d=\"M86.47,-88.56C86.47,-90.79 86.47,-93.07 86.47,-95.3\"/></g><g id=\"fig-78ffd352a6-b\" class=\"node\" data-part=\"b\"><ellipse fill=\"#ffffff\" stroke=\"#1f2a24\" stroke-width=\"1.4\" cx=\"86.47\" cy=\"-19.98\" rx=\"86.47\" ry=\"19.98\"/><text text-anchor=\"middle\" x=\"86.47\" y=\"-16.38\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" font-size=\"12.00\" fill=\"#1f2a24\">पाणी आणि कार्बन डायऑक्साइड</text></g><g id=\"fig-78ffd352a6-e2\" class=\"edge\" data-part=\"e2\"><path fill=\"none\" stroke=\"#3a4540\" stroke-width=\"1.3\" d=\"M86.47,-47.32C86.47,-45.09 86.47,-42.81 86.47,-40.58\"/></g></g></svg>",
  "description": "A mind map with 3 boxes: प्रकाश संश्लेषण; सूर्यप्रकाश; पाणी आणि कार्बन डायऑक्साइड. प्रकाश संश्लेषण is linked to सूर्यप्रकाश; प्रकाश संश्लेषण is linked to पाणी आणि कार्बन डायऑक्साइड.",
  "table": {
   "caption": "Each box and what it leads to",
   "columns": [
    "Box",
    "Leads to or linked with"
   ],
   "rows": [
    [
     "प्रकाश संश्लेषण",
     "सूर्यप्रकाश; पाणी आणि कार्बन डायऑक्साइड"
    ],
    [
     "सूर्यप्रकाश",
     "प्रकाश संश्लेषण"
    ],
    [
     "पाणी आणि कार्बन डायऑक्साइड",
     "प्रकाश संश्लेषण"
    ]
   ]
  },
  "ok": true,
  "parts": [
   {
    "part": "root",
    "label": "प्रकाश संश्लेषण"
   },
   {
    "part": "a",
    "label": "सूर्यप्रकाश"
   },
   {
    "part": "b",
    "label": "पाणी आणि कार्बन डायऑक्साइड"
   },
   {
    "part": "e1",
    "label": "प्रकाश संश्लेषण to सूर्यप्रकाश"
   },
   {
    "part": "e2",
    "label": "प्रकाश संश्लेषण to पाणी आणि कार्बन डायऑक्साइड"
   }
  ],
  "stepCount": 0,
  "steps": []
 }
};

export const FRAMES = {
 "plot": [
  {
   "caption": "The line y = 2x + 1.",
   "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 520 380\" width=\"520\" height=\"380\" role=\"img\" aria-labelledby=\"fig-c4d788667d-title fig-c4d788667d-desc\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" id=\"fig-c4d788667d\"><title id=\"fig-c4d788667d-title\">A line and a parabola</title><desc id=\"fig-c4d788667d-desc\">A graph with x from −5 to 5 (x) and y from −6 to 10 (y). It shows a region shaded from x = −1 to x = 1 under y = x² − 4; the straight line y = 2x + 1 (labelled f); the parabola y = x² − 4; the step graph with 2 pieces; a arrow from (0, 0) to (2, 4); point A at (1, 3). Step 1 of 2: The line y = 2x + 1.</desc><defs><clipPath id=\"fig-c4d788667d-clip\"><rect x=\"56\" y=\"38\" width=\"444\" height=\"290\"/></clipPath><marker id=\"fig-c4d788667d-arrow\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\" markerUnits=\"userSpaceOnUse\"><path d=\"M0,0 L10,5 L0,10 Z\" fill=\"#1F2A24\"/></marker></defs><rect x=\"0\" y=\"0\" width=\"520\" height=\"380\" fill=\"#FFFFFF\"/><text x=\"260\" y=\"20\" font-size=\"15\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\" font-weight=\"600\">A line and a parabola</text><g stroke=\"#E3E5E0\" stroke-width=\"1\"><line x1=\"56\" y1=\"38\" x2=\"56\" y2=\"328\"/><line x1=\"100.4\" y1=\"38\" x2=\"100.4\" y2=\"328\"/><line x1=\"144.8\" y1=\"38\" x2=\"144.8\" y2=\"328\"/><line x1=\"189.2\" y1=\"38\" x2=\"189.2\" y2=\"328\"/><line x1=\"233.6\" y1=\"38\" x2=\"233.6\" y2=\"328\"/><line x1=\"278\" y1=\"38\" x2=\"278\" y2=\"328\"/><line x1=\"322.4\" y1=\"38\" x2=\"322.4\" y2=\"328\"/><line x1=\"366.8\" y1=\"38\" x2=\"366.8\" y2=\"328\"/><line x1=\"411.2\" y1=\"38\" x2=\"411.2\" y2=\"328\"/><line x1=\"455.6\" y1=\"38\" x2=\"455.6\" y2=\"328\"/><line x1=\"500\" y1=\"38\" x2=\"500\" y2=\"328\"/><line x1=\"56\" y1=\"328\" x2=\"500\" y2=\"328\"/><line x1=\"56\" y1=\"291.75\" x2=\"500\" y2=\"291.75\"/><line x1=\"56\" y1=\"255.5\" x2=\"500\" y2=\"255.5\"/><line x1=\"56\" y1=\"219.25\" x2=\"500\" y2=\"219.25\"/><line x1=\"56\" y1=\"183\" x2=\"500\" y2=\"183\"/><line x1=\"56\" y1=\"146.75\" x2=\"500\" y2=\"146.75\"/><line x1=\"56\" y1=\"110.5\" x2=\"500\" y2=\"110.5\"/><line x1=\"56\" y1=\"74.25\" x2=\"500\" y2=\"74.25\"/><line x1=\"56\" y1=\"38\" x2=\"500\" y2=\"38\"/></g><g stroke=\"#3A4540\" stroke-width=\"1.4\"><line x1=\"56\" y1=\"219.25\" x2=\"500\" y2=\"219.25\"/><line x1=\"278\" y1=\"38\" x2=\"278\" y2=\"328\"/></g><line x1=\"56\" y1=\"219.25\" x2=\"56\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"56\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">−5</text><line x1=\"100.4\" y1=\"219.25\" x2=\"100.4\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"100.4\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">−4</text><line x1=\"144.8\" y1=\"219.25\" x2=\"144.8\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"144.8\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">−3</text><line x1=\"189.2\" y1=\"219.25\" x2=\"189.2\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"189.2\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">−2</text><line x1=\"233.6\" y1=\"219.25\" x2=\"233.6\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"233.6\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">−1</text><line x1=\"278\" y1=\"219.25\" x2=\"278\" y2=\"223.25\" stroke=\"#3A4540\"/><line x1=\"322.4\" y1=\"219.25\" x2=\"322.4\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"322.4\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">1</text><line x1=\"366.8\" y1=\"219.25\" x2=\"366.8\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"366.8\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">2</text><line x1=\"411.2\" y1=\"219.25\" x2=\"411.2\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"411.2\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">3</text><line x1=\"455.6\" y1=\"219.25\" x2=\"455.6\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"455.6\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">4</text><line x1=\"500\" y1=\"219.25\" x2=\"500\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"500\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">5</text><line x1=\"274\" y1=\"328\" x2=\"278\" y2=\"328\" stroke=\"#3A4540\"/><text x=\"271\" y=\"328\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">−6</text><line x1=\"274\" y1=\"291.75\" x2=\"278\" y2=\"291.75\" stroke=\"#3A4540\"/><text x=\"271\" y=\"291.75\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">−4</text><line x1=\"274\" y1=\"255.5\" x2=\"278\" y2=\"255.5\" stroke=\"#3A4540\"/><text x=\"271\" y=\"255.5\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">−2</text><line x1=\"274\" y1=\"219.25\" x2=\"278\" y2=\"219.25\" stroke=\"#3A4540\"/><line x1=\"274\" y1=\"183\" x2=\"278\" y2=\"183\" stroke=\"#3A4540\"/><text x=\"271\" y=\"183\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">2</text><line x1=\"274\" y1=\"146.75\" x2=\"278\" y2=\"146.75\" stroke=\"#3A4540\"/><text x=\"271\" y=\"146.75\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">4</text><line x1=\"274\" y1=\"110.5\" x2=\"278\" y2=\"110.5\" stroke=\"#3A4540\"/><text x=\"271\" y=\"110.5\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">6</text><line x1=\"274\" y1=\"74.25\" x2=\"278\" y2=\"74.25\" stroke=\"#3A4540\"/><text x=\"271\" y=\"74.25\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">8</text><line x1=\"274\" y1=\"38\" x2=\"278\" y2=\"38\" stroke=\"#3A4540\"/><text x=\"271\" y=\"38\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">10</text><text x=\"278\" y=\"366\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\">x</text><g transform=\"translate(16 183) rotate(-90)\"><text x=\"0\" y=\"0\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\">y</text></g><path id=\"fig-c4d788667d-area\" data-part=\"area\" d=\"M233.6,219.25 L233.6,273.63 L234.71,274.52 L235.82,275.39 L236.93,276.24 L238.04,277.07 L239.15,277.87 L240.26,278.65 L241.37,279.41 L242.48,280.15 L243.59,280.86 L244.7,281.55 L245.81,282.22 L246.92,282.87 L248.03,283.49 L249.14,284.09 L250.25,284.67 L251.36,285.23 L252.47,285.76 L253.58,286.27 L254.69,286.75 L255.8,287.22 L256.91,287.66 L258.02,288.08 L259.13,288.48 L260.24,288.85 L261.35,289.2 L262.46,289.53 L263.57,289.84 L264.68,290.12 L265.79,290.38 L266.9,290.62 L268.01,290.83 L269.12,291.03 L270.23,291.19 L271.34,291.34 L272.45,291.47 L273.56,291.57 L274.67,291.65 L275.78,291.7 L276.89,291.74 L278,291.75 L279.11,291.74 L280.22,291.7 L281.33,291.65 L282.44,291.57 L283.55,291.47 L284.66,291.34 L285.77,291.19 L286.88,291.03 L287.99,290.83 L289.1,290.62 L290.21,290.38 L291.32,290.12 L292.43,289.84 L293.54,289.53 L294.65,289.2 L295.76,288.85 L296.87,288.48 L297.98,288.08 L299.09,287.66 L300.2,287.22 L301.31,286.75 L302.42,286.27 L303.53,285.76 L304.64,285.23 L305.75,284.67 L306.86,284.09 L307.97,283.49 L309.08,282.87 L310.19,282.22 L311.3,281.55 L312.41,280.86 L313.52,280.15 L314.63,279.41 L315.74,278.65 L316.85,277.87 L317.96,277.07 L319.07,276.24 L320.18,275.39 L321.29,274.52 L322.4,273.63 L322.4,219.25 Z\" fill=\"#2F6B4F\" fill-opacity=\"0.16\" stroke=\"none\" clip-path=\"url(#fig-c4d788667d-clip)\"/><g id=\"fig-c4d788667d-line\" data-part=\"line\" clip-path=\"url(#fig-c4d788667d-clip)\"><path d=\"M56,382.4L58.2,380.6L60.4,378.8L62.7,376.9L64.9,375.1L67.1,373.3L69.3,371.5L71.5,369.7L73.8,367.9L76,366.1L78.2,364.3L80.4,362.4L82.6,360.6L84.9,358.8L87.1,357L89.3,355.2L91.5,353.4L93.7,351.6L96,349.7L98.2,347.9L100.4,346.1L102.6,344.3L104.8,342.5L107.1,340.7L109.3,338.9L111.5,337.1L113.7,335.3L115.9,333.4L118.2,331.6L120.4,329.8L122.6,328L124.8,326.2L127,324.4L129.3,322.6L131.5,320.8L133.7,318.9L135.9,317.1L138.1,315.3L140.4,313.5L142.6,311.7L144.8,309.9L147,308.1L149.2,306.3L151.5,304.4L153.7,302.6L155.9,300.8L158.1,299L160.3,297.2L162.6,295.4L164.8,293.6L167,291.8L169.2,289.9L171.4,288.1L173.7,286.3L175.9,284.5L178.1,282.7L180.3,280.9L182.5,279.1L184.8,277.2L187,275.4L189.2,273.6L191.4,271.8L193.6,270L195.9,268.2L198.1,266.4L200.3,264.6L202.5,262.8L204.7,260.9L207,259.1L209.2,257.3L211.4,255.5L213.6,253.7L215.8,251.9L218.1,250.1L220.3,248.2L222.5,246.4L224.7,244.6L226.9,242.8L229.2,241L231.4,239.2L233.6,237.4L235.8,235.6L238,233.8L240.3,231.9L242.5,230.1L244.7,228.3L246.9,226.5L249.1,224.7L251.4,222.9L253.6,221.1L255.8,219.3L258,217.4L260.2,215.6L262.5,213.8L264.7,212L266.9,210.2L269.1,208.4L271.3,206.6L273.6,204.8L275.8,202.9L278,201.1L280.2,199.3L282.4,197.5L284.7,195.7L286.9,193.9L289.1,192.1L291.3,190.3L293.5,188.4L295.8,186.6L298,184.8L300.2,183L302.4,181.2L304.6,179.4L306.9,177.6L309.1,175.7L311.3,173.9L313.5,172.1L315.7,170.3L318,168.5L320.2,166.7L322.4,164.9L324.6,163.1L326.8,161.3L329.1,159.4L331.3,157.6L333.5,155.8L335.7,154L337.9,152.2L340.2,150.4L342.4,148.6L344.6,146.8L346.8,144.9L349,143.1L351.3,141.3L353.5,139.5L355.7,137.7L357.9,135.9L360.1,134.1L362.4,132.2L364.6,130.4L366.8,128.6L369,126.8L371.2,125L373.5,123.2L375.7,121.4L377.9,119.6L380.1,117.8L382.3,115.9L384.6,114.1L386.8,112.3L389,110.5L391.2,108.7L393.4,106.9L395.7,105.1L397.9,103.3L400.1,101.4L402.3,99.6L404.5,97.8L406.8,96L409,94.2L411.2,92.4L413.4,90.6L415.6,88.8L417.9,86.9L420.1,85.1L422.3,83.3L424.5,81.5L426.7,79.7L429,77.9L431.2,76.1L433.4,74.3L435.6,72.4L437.8,70.6L440.1,68.8L442.3,67L444.5,65.2L446.7,63.4L448.9,61.6L451.2,59.7L453.4,57.9L455.6,56.1L457.8,54.3L460,52.5L462.3,50.7L464.5,48.9L466.7,47.1L468.9,45.2L471.1,43.4L473.4,41.6L475.6,39.8L477.8,38L480,36.2L482.2,34.4L484.5,32.6L486.7,30.8L488.9,28.9L491.1,27.1L493.3,25.3L495.6,23.5L497.8,21.7L500,19.9\" fill=\"none\" stroke=\"#B7862B\" stroke-width=\"3.5\" stroke-linejoin=\"round\"/></g><g id=\"fig-c4d788667d-curve\" data-part=\"curve\" clip-path=\"url(#fig-c4d788667d-clip)\"><path d=\"M56,-161.4L58.2,-152.4L60.4,-143.4L62.7,-134.6L64.9,-125.8L67.1,-117.2L69.3,-108.6L71.5,-100.2L73.8,-91.8L76,-83.5L78.2,-75.3L80.4,-67.2L82.6,-59.2L84.9,-51.2L87.1,-43.4L89.3,-35.6L91.5,-28L93.7,-20.4L96,-12.9L98.2,-5.5L100.4,1.8L102.6,9L104.8,16.1L107.1,23.1L109.3,30L111.5,36.9L113.7,43.6L115.9,50.3L118.2,56.8L120.4,63.3L122.6,69.7L124.8,76L127,82.2L129.3,88.3L131.5,94.4L133.7,100.3L135.9,106.1L138.1,111.9L140.4,117.6L142.6,123.1L144.8,128.6L147,134L149.2,139.3L151.5,144.5L153.7,149.7L155.9,154.7L158.1,159.6L160.3,164.5L162.6,169.2L164.8,173.9L167,178.5L169.2,183L171.4,187.4L173.7,191.7L175.9,195.9L178.1,200L180.3,204L182.5,208L184.8,211.8L187,215.6L189.2,219.3L191.4,222.8L193.6,226.3L195.9,229.7L198.1,233L200.3,236.2L202.5,239.4L204.7,242.4L207,245.4L209.2,248.2L211.4,251L213.6,253.6L215.8,256.2L218.1,258.7L220.3,261.1L222.5,263.4L224.7,265.7L226.9,267.8L229.2,269.8L231.4,271.8L233.6,273.6L235.8,275.4L238,277.1L240.3,278.7L242.5,280.2L244.7,281.6L246.9,282.9L249.1,284.1L251.4,285.2L253.6,286.3L255.8,287.2L258,288.1L260.2,288.8L262.5,289.5L264.7,290.1L266.9,290.6L269.1,291L271.3,291.3L273.6,291.6L275.8,291.7L278,291.8L280.2,291.7L282.4,291.6L284.7,291.3L286.9,291L289.1,290.6L291.3,290.1L293.5,289.5L295.8,288.8L298,288.1L300.2,287.2L302.4,286.3L304.6,285.2L306.9,284.1L309.1,282.9L311.3,281.6L313.5,280.2L315.7,278.7L318,277.1L320.2,275.4L322.4,273.6L324.6,271.8L326.8,269.8L329.1,267.8L331.3,265.7L333.5,263.4L335.7,261.1L337.9,258.7L340.2,256.2L342.4,253.6L344.6,251L346.8,248.2L349,245.4L351.3,242.4L353.5,239.4L355.7,236.2L357.9,233L360.1,229.7L362.4,226.3L364.6,222.8L366.8,219.3L369,215.6L371.2,211.8L373.5,208L375.7,204L377.9,200L380.1,195.9L382.3,191.7L384.6,187.3L386.8,183L389,178.5L391.2,173.9L393.4,169.2L395.7,164.5L397.9,159.6L400.1,154.7L402.3,149.7L404.5,144.5L406.8,139.3L409,134L411.2,128.6L413.4,123.1L415.6,117.6L417.9,111.9L420.1,106.2L422.3,100.3L424.5,94.4L426.7,88.3L429,82.2L431.2,76L433.4,69.7L435.6,63.3L437.8,56.9L440.1,50.3L442.3,43.6L444.5,36.9L446.7,30L448.9,23.1L451.2,16.1L453.4,9L455.6,1.8L457.8,-5.5L460,-12.9L462.3,-20.4L464.5,-28L466.7,-35.6L468.9,-43.4L471.1,-51.2L473.4,-59.2L475.6,-67.2L477.8,-75.3L480,-83.5L482.2,-91.8L484.5,-100.2L486.7,-108.6L488.9,-117.2L491.1,-125.9L493.3,-134.6L495.6,-143.4L497.8,-152.4L500,-161.4\" fill=\"none\" stroke=\"#B7862B\" stroke-width=\"2.2\" stroke-dasharray=\"6 4\" stroke-linejoin=\"round\"/></g><g id=\"fig-c4d788667d-steps\" data-part=\"steps\" clip-path=\"url(#fig-c4d788667d-clip)\"><line x1=\"100.4\" y1=\"309.88\" x2=\"189.2\" y2=\"309.88\" stroke=\"#4F6D8A\" stroke-width=\"2.2\"/><circle cx=\"100.4\" cy=\"309.88\" r=\"4\" fill=\"#4F6D8A\" stroke=\"#4F6D8A\" stroke-width=\"1.6\"/><circle cx=\"189.2\" cy=\"309.88\" r=\"4\" fill=\"#FFFFFF\" stroke=\"#4F6D8A\" stroke-width=\"1.6\"/><line x1=\"189.2\" y1=\"273.63\" x2=\"278\" y2=\"273.63\" stroke=\"#4F6D8A\" stroke-width=\"2.2\"/><circle cx=\"189.2\" cy=\"273.63\" r=\"4\" fill=\"#FFFFFF\" stroke=\"#4F6D8A\" stroke-width=\"1.6\"/><circle cx=\"278\" cy=\"273.63\" r=\"4\" fill=\"#FFFFFF\" stroke=\"#4F6D8A\" stroke-width=\"1.6\"/></g><line id=\"fig-c4d788667d-v\" data-part=\"v\" x1=\"278\" y1=\"219.25\" x2=\"366.8\" y2=\"146.75\" stroke=\"#1F2A24\" stroke-width=\"2\" marker-end=\"url(#fig-c4d788667d-arrow)\" clip-path=\"url(#fig-c4d788667d-clip)\"/><g id=\"fig-c4d788667d-A\" data-part=\"A\"><circle cx=\"322.4\" cy=\"164.88\" r=\"4.5\" fill=\"#1F2A24\" stroke=\"#1F2A24\" stroke-width=\"1.8\"/><text x=\"330.4\" y=\"154.88\" font-size=\"12\" text-anchor=\"start\" dominant-baseline=\"middle\" fill=\"#1F2A24\" font-weight=\"600\">A</text></g></svg>",
   "description": "A graph with x from −5 to 5 (x) and y from −6 to 10 (y). It shows a region shaded from x = −1 to x = 1 under y = x² − 4; the straight line y = 2x + 1 (labelled f); the parabola y = x² − 4; the step graph with 2 pieces; a arrow from (0, 0) to (2, 4); point A at (1, 3). Step 1 of 2: The line y = 2x + 1."
  },
  {
   "caption": "Point A lies on the line, not the curve.",
   "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 520 380\" width=\"520\" height=\"380\" role=\"img\" aria-labelledby=\"fig-c4d788667d-title fig-c4d788667d-desc\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" id=\"fig-c4d788667d\"><title id=\"fig-c4d788667d-title\">A line and a parabola</title><desc id=\"fig-c4d788667d-desc\">A graph with x from −5 to 5 (x) and y from −6 to 10 (y). It shows a region shaded from x = −1 to x = 1 under y = x² − 4; the straight line y = 2x + 1 (labelled f); the parabola y = x² − 4; the step graph with 2 pieces; a arrow from (0, 0) to (2, 4); point A at (1, 3). Step 2 of 2: Point A lies on the line, not the curve.</desc><defs><clipPath id=\"fig-c4d788667d-clip\"><rect x=\"56\" y=\"38\" width=\"444\" height=\"290\"/></clipPath><marker id=\"fig-c4d788667d-arrow\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\" markerUnits=\"userSpaceOnUse\"><path d=\"M0,0 L10,5 L0,10 Z\" fill=\"#1F2A24\"/></marker></defs><rect x=\"0\" y=\"0\" width=\"520\" height=\"380\" fill=\"#FFFFFF\"/><text x=\"260\" y=\"20\" font-size=\"15\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\" font-weight=\"600\">A line and a parabola</text><g stroke=\"#E3E5E0\" stroke-width=\"1\"><line x1=\"56\" y1=\"38\" x2=\"56\" y2=\"328\"/><line x1=\"100.4\" y1=\"38\" x2=\"100.4\" y2=\"328\"/><line x1=\"144.8\" y1=\"38\" x2=\"144.8\" y2=\"328\"/><line x1=\"189.2\" y1=\"38\" x2=\"189.2\" y2=\"328\"/><line x1=\"233.6\" y1=\"38\" x2=\"233.6\" y2=\"328\"/><line x1=\"278\" y1=\"38\" x2=\"278\" y2=\"328\"/><line x1=\"322.4\" y1=\"38\" x2=\"322.4\" y2=\"328\"/><line x1=\"366.8\" y1=\"38\" x2=\"366.8\" y2=\"328\"/><line x1=\"411.2\" y1=\"38\" x2=\"411.2\" y2=\"328\"/><line x1=\"455.6\" y1=\"38\" x2=\"455.6\" y2=\"328\"/><line x1=\"500\" y1=\"38\" x2=\"500\" y2=\"328\"/><line x1=\"56\" y1=\"328\" x2=\"500\" y2=\"328\"/><line x1=\"56\" y1=\"291.75\" x2=\"500\" y2=\"291.75\"/><line x1=\"56\" y1=\"255.5\" x2=\"500\" y2=\"255.5\"/><line x1=\"56\" y1=\"219.25\" x2=\"500\" y2=\"219.25\"/><line x1=\"56\" y1=\"183\" x2=\"500\" y2=\"183\"/><line x1=\"56\" y1=\"146.75\" x2=\"500\" y2=\"146.75\"/><line x1=\"56\" y1=\"110.5\" x2=\"500\" y2=\"110.5\"/><line x1=\"56\" y1=\"74.25\" x2=\"500\" y2=\"74.25\"/><line x1=\"56\" y1=\"38\" x2=\"500\" y2=\"38\"/></g><g stroke=\"#3A4540\" stroke-width=\"1.4\"><line x1=\"56\" y1=\"219.25\" x2=\"500\" y2=\"219.25\"/><line x1=\"278\" y1=\"38\" x2=\"278\" y2=\"328\"/></g><line x1=\"56\" y1=\"219.25\" x2=\"56\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"56\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">−5</text><line x1=\"100.4\" y1=\"219.25\" x2=\"100.4\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"100.4\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">−4</text><line x1=\"144.8\" y1=\"219.25\" x2=\"144.8\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"144.8\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">−3</text><line x1=\"189.2\" y1=\"219.25\" x2=\"189.2\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"189.2\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">−2</text><line x1=\"233.6\" y1=\"219.25\" x2=\"233.6\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"233.6\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">−1</text><line x1=\"278\" y1=\"219.25\" x2=\"278\" y2=\"223.25\" stroke=\"#3A4540\"/><line x1=\"322.4\" y1=\"219.25\" x2=\"322.4\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"322.4\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">1</text><line x1=\"366.8\" y1=\"219.25\" x2=\"366.8\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"366.8\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">2</text><line x1=\"411.2\" y1=\"219.25\" x2=\"411.2\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"411.2\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">3</text><line x1=\"455.6\" y1=\"219.25\" x2=\"455.6\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"455.6\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">4</text><line x1=\"500\" y1=\"219.25\" x2=\"500\" y2=\"223.25\" stroke=\"#3A4540\"/><text x=\"500\" y=\"233.25\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">5</text><line x1=\"274\" y1=\"328\" x2=\"278\" y2=\"328\" stroke=\"#3A4540\"/><text x=\"271\" y=\"328\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">−6</text><line x1=\"274\" y1=\"291.75\" x2=\"278\" y2=\"291.75\" stroke=\"#3A4540\"/><text x=\"271\" y=\"291.75\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">−4</text><line x1=\"274\" y1=\"255.5\" x2=\"278\" y2=\"255.5\" stroke=\"#3A4540\"/><text x=\"271\" y=\"255.5\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">−2</text><line x1=\"274\" y1=\"219.25\" x2=\"278\" y2=\"219.25\" stroke=\"#3A4540\"/><line x1=\"274\" y1=\"183\" x2=\"278\" y2=\"183\" stroke=\"#3A4540\"/><text x=\"271\" y=\"183\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">2</text><line x1=\"274\" y1=\"146.75\" x2=\"278\" y2=\"146.75\" stroke=\"#3A4540\"/><text x=\"271\" y=\"146.75\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">4</text><line x1=\"274\" y1=\"110.5\" x2=\"278\" y2=\"110.5\" stroke=\"#3A4540\"/><text x=\"271\" y=\"110.5\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">6</text><line x1=\"274\" y1=\"74.25\" x2=\"278\" y2=\"74.25\" stroke=\"#3A4540\"/><text x=\"271\" y=\"74.25\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">8</text><line x1=\"274\" y1=\"38\" x2=\"278\" y2=\"38\" stroke=\"#3A4540\"/><text x=\"271\" y=\"38\" font-size=\"11\" text-anchor=\"end\" dominant-baseline=\"middle\" fill=\"#585C63\">10</text><text x=\"278\" y=\"366\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\">x</text><g transform=\"translate(16 183) rotate(-90)\"><text x=\"0\" y=\"0\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\">y</text></g><path id=\"fig-c4d788667d-area\" data-part=\"area\" d=\"M233.6,219.25 L233.6,273.63 L234.71,274.52 L235.82,275.39 L236.93,276.24 L238.04,277.07 L239.15,277.87 L240.26,278.65 L241.37,279.41 L242.48,280.15 L243.59,280.86 L244.7,281.55 L245.81,282.22 L246.92,282.87 L248.03,283.49 L249.14,284.09 L250.25,284.67 L251.36,285.23 L252.47,285.76 L253.58,286.27 L254.69,286.75 L255.8,287.22 L256.91,287.66 L258.02,288.08 L259.13,288.48 L260.24,288.85 L261.35,289.2 L262.46,289.53 L263.57,289.84 L264.68,290.12 L265.79,290.38 L266.9,290.62 L268.01,290.83 L269.12,291.03 L270.23,291.19 L271.34,291.34 L272.45,291.47 L273.56,291.57 L274.67,291.65 L275.78,291.7 L276.89,291.74 L278,291.75 L279.11,291.74 L280.22,291.7 L281.33,291.65 L282.44,291.57 L283.55,291.47 L284.66,291.34 L285.77,291.19 L286.88,291.03 L287.99,290.83 L289.1,290.62 L290.21,290.38 L291.32,290.12 L292.43,289.84 L293.54,289.53 L294.65,289.2 L295.76,288.85 L296.87,288.48 L297.98,288.08 L299.09,287.66 L300.2,287.22 L301.31,286.75 L302.42,286.27 L303.53,285.76 L304.64,285.23 L305.75,284.67 L306.86,284.09 L307.97,283.49 L309.08,282.87 L310.19,282.22 L311.3,281.55 L312.41,280.86 L313.52,280.15 L314.63,279.41 L315.74,278.65 L316.85,277.87 L317.96,277.07 L319.07,276.24 L320.18,275.39 L321.29,274.52 L322.4,273.63 L322.4,219.25 Z\" fill=\"#2F6B4F\" fill-opacity=\"0.16\" stroke=\"none\" clip-path=\"url(#fig-c4d788667d-clip)\"/><g id=\"fig-c4d788667d-line\" data-part=\"line\" clip-path=\"url(#fig-c4d788667d-clip)\"><path d=\"M56,382.4L58.2,380.6L60.4,378.8L62.7,376.9L64.9,375.1L67.1,373.3L69.3,371.5L71.5,369.7L73.8,367.9L76,366.1L78.2,364.3L80.4,362.4L82.6,360.6L84.9,358.8L87.1,357L89.3,355.2L91.5,353.4L93.7,351.6L96,349.7L98.2,347.9L100.4,346.1L102.6,344.3L104.8,342.5L107.1,340.7L109.3,338.9L111.5,337.1L113.7,335.3L115.9,333.4L118.2,331.6L120.4,329.8L122.6,328L124.8,326.2L127,324.4L129.3,322.6L131.5,320.8L133.7,318.9L135.9,317.1L138.1,315.3L140.4,313.5L142.6,311.7L144.8,309.9L147,308.1L149.2,306.3L151.5,304.4L153.7,302.6L155.9,300.8L158.1,299L160.3,297.2L162.6,295.4L164.8,293.6L167,291.8L169.2,289.9L171.4,288.1L173.7,286.3L175.9,284.5L178.1,282.7L180.3,280.9L182.5,279.1L184.8,277.2L187,275.4L189.2,273.6L191.4,271.8L193.6,270L195.9,268.2L198.1,266.4L200.3,264.6L202.5,262.8L204.7,260.9L207,259.1L209.2,257.3L211.4,255.5L213.6,253.7L215.8,251.9L218.1,250.1L220.3,248.2L222.5,246.4L224.7,244.6L226.9,242.8L229.2,241L231.4,239.2L233.6,237.4L235.8,235.6L238,233.8L240.3,231.9L242.5,230.1L244.7,228.3L246.9,226.5L249.1,224.7L251.4,222.9L253.6,221.1L255.8,219.3L258,217.4L260.2,215.6L262.5,213.8L264.7,212L266.9,210.2L269.1,208.4L271.3,206.6L273.6,204.8L275.8,202.9L278,201.1L280.2,199.3L282.4,197.5L284.7,195.7L286.9,193.9L289.1,192.1L291.3,190.3L293.5,188.4L295.8,186.6L298,184.8L300.2,183L302.4,181.2L304.6,179.4L306.9,177.6L309.1,175.7L311.3,173.9L313.5,172.1L315.7,170.3L318,168.5L320.2,166.7L322.4,164.9L324.6,163.1L326.8,161.3L329.1,159.4L331.3,157.6L333.5,155.8L335.7,154L337.9,152.2L340.2,150.4L342.4,148.6L344.6,146.8L346.8,144.9L349,143.1L351.3,141.3L353.5,139.5L355.7,137.7L357.9,135.9L360.1,134.1L362.4,132.2L364.6,130.4L366.8,128.6L369,126.8L371.2,125L373.5,123.2L375.7,121.4L377.9,119.6L380.1,117.8L382.3,115.9L384.6,114.1L386.8,112.3L389,110.5L391.2,108.7L393.4,106.9L395.7,105.1L397.9,103.3L400.1,101.4L402.3,99.6L404.5,97.8L406.8,96L409,94.2L411.2,92.4L413.4,90.6L415.6,88.8L417.9,86.9L420.1,85.1L422.3,83.3L424.5,81.5L426.7,79.7L429,77.9L431.2,76.1L433.4,74.3L435.6,72.4L437.8,70.6L440.1,68.8L442.3,67L444.5,65.2L446.7,63.4L448.9,61.6L451.2,59.7L453.4,57.9L455.6,56.1L457.8,54.3L460,52.5L462.3,50.7L464.5,48.9L466.7,47.1L468.9,45.2L471.1,43.4L473.4,41.6L475.6,39.8L477.8,38L480,36.2L482.2,34.4L484.5,32.6L486.7,30.8L488.9,28.9L491.1,27.1L493.3,25.3L495.6,23.5L497.8,21.7L500,19.9\" fill=\"none\" stroke=\"#2F6B4F\" stroke-width=\"2.2\" stroke-linejoin=\"round\"/></g><g id=\"fig-c4d788667d-curve\" data-part=\"curve\" clip-path=\"url(#fig-c4d788667d-clip)\"><path d=\"M56,-161.4L58.2,-152.4L60.4,-143.4L62.7,-134.6L64.9,-125.8L67.1,-117.2L69.3,-108.6L71.5,-100.2L73.8,-91.8L76,-83.5L78.2,-75.3L80.4,-67.2L82.6,-59.2L84.9,-51.2L87.1,-43.4L89.3,-35.6L91.5,-28L93.7,-20.4L96,-12.9L98.2,-5.5L100.4,1.8L102.6,9L104.8,16.1L107.1,23.1L109.3,30L111.5,36.9L113.7,43.6L115.9,50.3L118.2,56.8L120.4,63.3L122.6,69.7L124.8,76L127,82.2L129.3,88.3L131.5,94.4L133.7,100.3L135.9,106.1L138.1,111.9L140.4,117.6L142.6,123.1L144.8,128.6L147,134L149.2,139.3L151.5,144.5L153.7,149.7L155.9,154.7L158.1,159.6L160.3,164.5L162.6,169.2L164.8,173.9L167,178.5L169.2,183L171.4,187.4L173.7,191.7L175.9,195.9L178.1,200L180.3,204L182.5,208L184.8,211.8L187,215.6L189.2,219.3L191.4,222.8L193.6,226.3L195.9,229.7L198.1,233L200.3,236.2L202.5,239.4L204.7,242.4L207,245.4L209.2,248.2L211.4,251L213.6,253.6L215.8,256.2L218.1,258.7L220.3,261.1L222.5,263.4L224.7,265.7L226.9,267.8L229.2,269.8L231.4,271.8L233.6,273.6L235.8,275.4L238,277.1L240.3,278.7L242.5,280.2L244.7,281.6L246.9,282.9L249.1,284.1L251.4,285.2L253.6,286.3L255.8,287.2L258,288.1L260.2,288.8L262.5,289.5L264.7,290.1L266.9,290.6L269.1,291L271.3,291.3L273.6,291.6L275.8,291.7L278,291.8L280.2,291.7L282.4,291.6L284.7,291.3L286.9,291L289.1,290.6L291.3,290.1L293.5,289.5L295.8,288.8L298,288.1L300.2,287.2L302.4,286.3L304.6,285.2L306.9,284.1L309.1,282.9L311.3,281.6L313.5,280.2L315.7,278.7L318,277.1L320.2,275.4L322.4,273.6L324.6,271.8L326.8,269.8L329.1,267.8L331.3,265.7L333.5,263.4L335.7,261.1L337.9,258.7L340.2,256.2L342.4,253.6L344.6,251L346.8,248.2L349,245.4L351.3,242.4L353.5,239.4L355.7,236.2L357.9,233L360.1,229.7L362.4,226.3L364.6,222.8L366.8,219.3L369,215.6L371.2,211.8L373.5,208L375.7,204L377.9,200L380.1,195.9L382.3,191.7L384.6,187.3L386.8,183L389,178.5L391.2,173.9L393.4,169.2L395.7,164.5L397.9,159.6L400.1,154.7L402.3,149.7L404.5,144.5L406.8,139.3L409,134L411.2,128.6L413.4,123.1L415.6,117.6L417.9,111.9L420.1,106.2L422.3,100.3L424.5,94.4L426.7,88.3L429,82.2L431.2,76L433.4,69.7L435.6,63.3L437.8,56.9L440.1,50.3L442.3,43.6L444.5,36.9L446.7,30L448.9,23.1L451.2,16.1L453.4,9L455.6,1.8L457.8,-5.5L460,-12.9L462.3,-20.4L464.5,-28L466.7,-35.6L468.9,-43.4L471.1,-51.2L473.4,-59.2L475.6,-67.2L477.8,-75.3L480,-83.5L482.2,-91.8L484.5,-100.2L486.7,-108.6L488.9,-117.2L491.1,-125.9L493.3,-134.6L495.6,-143.4L497.8,-152.4L500,-161.4\" fill=\"none\" stroke=\"#B7862B\" stroke-width=\"3.5\" stroke-dasharray=\"6 4\" stroke-linejoin=\"round\"/></g><g id=\"fig-c4d788667d-steps\" data-part=\"steps\" clip-path=\"url(#fig-c4d788667d-clip)\"><line x1=\"100.4\" y1=\"309.88\" x2=\"189.2\" y2=\"309.88\" stroke=\"#4F6D8A\" stroke-width=\"2.2\"/><circle cx=\"100.4\" cy=\"309.88\" r=\"4\" fill=\"#4F6D8A\" stroke=\"#4F6D8A\" stroke-width=\"1.6\"/><circle cx=\"189.2\" cy=\"309.88\" r=\"4\" fill=\"#FFFFFF\" stroke=\"#4F6D8A\" stroke-width=\"1.6\"/><line x1=\"189.2\" y1=\"273.63\" x2=\"278\" y2=\"273.63\" stroke=\"#4F6D8A\" stroke-width=\"2.2\"/><circle cx=\"189.2\" cy=\"273.63\" r=\"4\" fill=\"#FFFFFF\" stroke=\"#4F6D8A\" stroke-width=\"1.6\"/><circle cx=\"278\" cy=\"273.63\" r=\"4\" fill=\"#FFFFFF\" stroke=\"#4F6D8A\" stroke-width=\"1.6\"/></g><line id=\"fig-c4d788667d-v\" data-part=\"v\" x1=\"278\" y1=\"219.25\" x2=\"366.8\" y2=\"146.75\" stroke=\"#1F2A24\" stroke-width=\"2\" marker-end=\"url(#fig-c4d788667d-arrow)\" clip-path=\"url(#fig-c4d788667d-clip)\"/><g id=\"fig-c4d788667d-A\" data-part=\"A\"><circle cx=\"322.4\" cy=\"164.88\" r=\"6\" fill=\"#B7862B\" stroke=\"#B7862B\" stroke-width=\"1.8\"/><text x=\"330.4\" y=\"154.88\" font-size=\"12\" text-anchor=\"start\" dominant-baseline=\"middle\" fill=\"#1F2A24\" font-weight=\"600\">A</text></g></svg>",
   "description": "A graph with x from −5 to 5 (x) and y from −6 to 10 (y). It shows a region shaded from x = −1 to x = 1 under y = x² − 4; the straight line y = 2x + 1 (labelled f); the parabola y = x² − 4; the step graph with 2 pieces; a arrow from (0, 0) to (2, 4); point A at (1, 3). Step 2 of 2: Point A lies on the line, not the curve."
  }
 ],
 "geometry": [
  {
   "caption": "The angle at A.",
   "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 449.14 400\" width=\"449.14\" height=\"400\" role=\"img\" aria-labelledby=\"fig-432012544f-title fig-432012544f-desc\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" id=\"fig-432012544f\"><title id=\"fig-432012544f-title\">Geometry drawing</title><desc id=\"fig-432012544f-desc\">A drawing on a frame from (−1, −1) to (7, 6). Points: A at (0, 0), B at (6, 0), C at (2, 5). It shows a shape with corners A, B, C; the angle x (BAC) of 68.2 degrees; the arrow W of length 2 pointing down. Step 1 of 1: The angle at A.</desc><defs><clipPath id=\"fig-432012544f-clip\"><rect x=\"22\" y=\"22\" width=\"405.14\" height=\"356\"/></clipPath><marker id=\"fig-432012544f-vec\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\" markerUnits=\"userSpaceOnUse\"><path d=\"M0,0 L10,5 L0,10 Z\" fill=\"#2F6B4F\"/></marker><marker id=\"fig-432012544f-hl\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\" markerUnits=\"userSpaceOnUse\"><path d=\"M0,0 L10,5 L0,10 Z\" fill=\"#B7862B\"/></marker></defs><rect x=\"0\" y=\"0\" width=\"449.14\" height=\"400\" fill=\"#FFFFFF\"/><polygon id=\"fig-432012544f-tri\" data-part=\"tri\" points=\"77.14,322.86 372,322.86 175.43,77.14\" fill=\"#2F6B4F\" fill-opacity=\"0.06\" stroke=\"#1F2A24\" stroke-width=\"1.8\" stroke-linejoin=\"round\" clip-path=\"url(#fig-432012544f-clip)\"/><g id=\"fig-432012544f-atA\" data-part=\"atA\"><path d=\"M97.14,322.86 A20,20 0 0 0 84.57,304.29\" fill=\"none\" stroke=\"#B7862B\" stroke-width=\"3\"/></g><text x=\"105.3\" y=\"303.8\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#B7862B\" font-weight=\"600\">x</text><line id=\"fig-432012544f-W\" data-part=\"W\" x1=\"175.43\" y1=\"77.14\" x2=\"175.43\" y2=\"175.43\" stroke=\"#2F6B4F\" stroke-width=\"2.6\" marker-end=\"url(#fig-432012544f-vec)\"/><text x=\"175.43\" y=\"189.43\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#2F6B4F\" font-weight=\"600\">W</text><g id=\"fig-432012544f-A\" data-part=\"A\"><circle cx=\"77.14\" cy=\"322.86\" r=\"3.8\" fill=\"#1F2A24\"/><text x=\"84.14\" y=\"313.86\" font-size=\"13\" text-anchor=\"start\" dominant-baseline=\"middle\" fill=\"#1F2A24\" font-weight=\"600\">A</text></g><g id=\"fig-432012544f-B\" data-part=\"B\"><circle cx=\"372\" cy=\"322.86\" r=\"3.8\" fill=\"#1F2A24\"/><text x=\"379\" y=\"313.86\" font-size=\"13\" text-anchor=\"start\" dominant-baseline=\"middle\" fill=\"#1F2A24\" font-weight=\"600\">B</text></g><g id=\"fig-432012544f-C\" data-part=\"C\"><circle cx=\"175.43\" cy=\"77.14\" r=\"3.8\" fill=\"#1F2A24\"/><text x=\"182.43\" y=\"68.14\" font-size=\"13\" text-anchor=\"start\" dominant-baseline=\"middle\" fill=\"#1F2A24\" font-weight=\"600\">C</text></g></svg>",
   "description": "A drawing on a frame from (−1, −1) to (7, 6). Points: A at (0, 0), B at (6, 0), C at (2, 5). It shows a shape with corners A, B, C; the angle x (BAC) of 68.2 degrees; the arrow W of length 2 pointing down. Step 1 of 1: The angle at A."
  }
 ],
 "diagram": [
  {
   "caption": "Check the base case first.",
   "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 224 232\" width=\"224\" height=\"232\" role=\"img\" aria-labelledby=\"fig-e76757fedf-title fig-e76757fedf-desc\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" id=\"fig-e76757fedf\"><title id=\"fig-e76757fedf-title\">Factorial</title><desc id=\"fig-e76757fedf-desc\">A flowchart with 4 boxes: Start; Is n &gt; 1?; n × fact(n - 1); Return 1. Start leads to Is n &gt; 1?; Is n &gt; 1? leads to n × fact(n - 1) (yes); Is n &gt; 1? leads to Return 1 (no). Step 1 of 2: Check the base case first.</desc><rect x=\"0\" y=\"0\" width=\"224\" height=\"232\" fill=\"#FFFFFF\"/><g id=\"fig-e76757fedf-graph\" class=\"graph\" transform=\"scale(1 1) rotate(0) translate(14.4 217.18)\"><g id=\"fig-e76757fedf-start\" class=\"node\" data-part=\"start\"><ellipse fill=\"#ffffff\" stroke=\"#1f2a24\" stroke-width=\"1.4\" cx=\"107.13\" cy=\"-182.8\" rx=\"30.1\" ry=\"19.98\"/><text text-anchor=\"middle\" x=\"107.13\" y=\"-179.2\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" font-size=\"12.00\" fill=\"#1f2a24\">Start</text></g><g id=\"fig-e76757fedf-test\" class=\"node\" data-part=\"test\"><polygon fill=\"#fbf3e2\" stroke=\"#b7862b\" stroke-width=\"3\" points=\"107.13,-129.82 43.01,-101.71 107.13,-73.59 171.24,-101.71 107.13,-129.82\"/><text text-anchor=\"middle\" x=\"107.13\" y=\"-98.11\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" font-size=\"12.00\" fill=\"#1f2a24\">Is n &gt; 1?</text></g><g id=\"fig-e76757fedf-e1\" class=\"edge\" data-part=\"e1\"><path fill=\"none\" stroke=\"#3a4540\" stroke-width=\"1.3\" d=\"M107.13,-162.25C107.13,-155.84 107.13,-148.47 107.13,-141.15\"/><polygon fill=\"#3a4540\" stroke=\"#3a4540\" stroke-width=\"1.3\" points=\"109.93,-141.26 107.13,-133.26 104.33,-141.26 109.93,-141.26\"/></g><g id=\"fig-e76757fedf-mul\" class=\"node\" data-part=\"mul\"><path fill=\"#ffffff\" stroke=\"#1f2a24\" stroke-width=\"1.4\" d=\"M94.39,-29.59C94.39,-29.59 9.86,-29.59 9.86,-29.59 4.93,-29.59 0,-24.66 0,-19.73 0,-19.73 0,-9.86 0,-9.86 0,-4.93 4.93,0 9.86,0 9.86,0 94.39,0 94.39,0 99.32,0 104.26,-4.93 104.26,-9.86 104.26,-9.86 104.26,-19.73 104.26,-19.73 104.26,-24.66 99.32,-29.59 94.39,-29.59\"/><text text-anchor=\"middle\" x=\"52.13\" y=\"-11.2\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" font-size=\"12.00\" fill=\"#1f2a24\">n × fact(n &#45; 1)</text></g><g id=\"fig-e76757fedf-yes\" class=\"edge\" data-part=\"yes\"><path fill=\"none\" stroke=\"#3a4540\" stroke-width=\"1.3\" d=\"M92.68,-78.4C84.66,-66.02 74.72,-50.67 66.69,-38.27\"/><polygon fill=\"#3a4540\" stroke=\"#3a4540\" stroke-width=\"1.3\" points=\"69.24,-37.07 62.55,-31.88 64.54,-40.12 69.24,-37.07\"/><text text-anchor=\"middle\" x=\"84.64\" y=\"-48.59\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" font-size=\"10.00\" fill=\"#1f2a24\">yes</text></g><g id=\"fig-e76757fedf-one\" class=\"node\" data-part=\"one\"><path fill=\"#ffffff\" stroke=\"#1f2a24\" stroke-width=\"1.4\" d=\"M185.24,-29.59C185.24,-29.59 139.02,-29.59 139.02,-29.59 134.08,-29.59 129.15,-24.66 129.15,-19.73 129.15,-19.73 129.15,-9.86 129.15,-9.86 129.15,-4.93 134.08,0 139.02,0 139.02,0 185.24,0 185.24,0 190.17,0 195.1,-4.93 195.1,-9.86 195.1,-9.86 195.1,-19.73 195.1,-19.73 195.1,-24.66 190.17,-29.59 185.24,-29.59\"/><text text-anchor=\"middle\" x=\"162.13\" y=\"-11.2\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" font-size=\"12.00\" fill=\"#1f2a24\">Return 1</text></g><g id=\"fig-e76757fedf-no\" class=\"edge\" data-part=\"no\"><path fill=\"none\" stroke=\"#3a4540\" stroke-width=\"1.3\" d=\"M121.58,-78.4C129.6,-66.02 139.54,-50.67 147.57,-38.27\"/><polygon fill=\"#3a4540\" stroke=\"#3a4540\" stroke-width=\"1.3\" points=\"149.71,-40.12 151.71,-31.88 145.01,-37.07 149.71,-40.12\"/><text text-anchor=\"middle\" x=\"147.77\" y=\"-48.59\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" font-size=\"10.00\" fill=\"#1f2a24\">no</text></g></g></svg>",
   "description": "A flowchart with 4 boxes: Start; Is n > 1?; n × fact(n - 1); Return 1. Start leads to Is n > 1?; Is n > 1? leads to n × fact(n - 1) (yes); Is n > 1? leads to Return 1 (no). Step 1 of 2: Check the base case first."
  },
  {
   "caption": "n is 1, so return 1.",
   "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 224 232\" width=\"224\" height=\"232\" role=\"img\" aria-labelledby=\"fig-e76757fedf-title fig-e76757fedf-desc\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" id=\"fig-e76757fedf\"><title id=\"fig-e76757fedf-title\">Factorial</title><desc id=\"fig-e76757fedf-desc\">A flowchart with 4 boxes: Start; Is n &gt; 1?; n × fact(n - 1); Return 1. Start leads to Is n &gt; 1?; Is n &gt; 1? leads to n × fact(n - 1) (yes); Is n &gt; 1? leads to Return 1 (no). Step 2 of 2: n is 1, so return 1.</desc><rect x=\"0\" y=\"0\" width=\"224\" height=\"232\" fill=\"#FFFFFF\"/><g id=\"fig-e76757fedf-graph\" class=\"graph\" transform=\"scale(1 1) rotate(0) translate(14.4 217.18)\"><g id=\"fig-e76757fedf-start\" class=\"node\" data-part=\"start\"><ellipse fill=\"#ffffff\" stroke=\"#1f2a24\" stroke-width=\"1.4\" cx=\"107.13\" cy=\"-182.8\" rx=\"30.1\" ry=\"19.98\"/><text text-anchor=\"middle\" x=\"107.13\" y=\"-179.2\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" font-size=\"12.00\" fill=\"#1f2a24\">Start</text></g><g id=\"fig-e76757fedf-test\" class=\"node\" data-part=\"test\"><polygon fill=\"#ffffff\" stroke=\"#1f2a24\" stroke-width=\"1.4\" points=\"107.13,-129.82 43.01,-101.71 107.13,-73.59 171.24,-101.71 107.13,-129.82\"/><text text-anchor=\"middle\" x=\"107.13\" y=\"-98.11\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" font-size=\"12.00\" fill=\"#1f2a24\">Is n &gt; 1?</text></g><g id=\"fig-e76757fedf-e1\" class=\"edge\" data-part=\"e1\"><path fill=\"none\" stroke=\"#3a4540\" stroke-width=\"1.3\" d=\"M107.13,-162.25C107.13,-155.57 107.13,-147.86 107.13,-140.25\"/><polygon fill=\"#3a4540\" stroke=\"#3a4540\" stroke-width=\"1.3\" points=\"109.93,-140.36 107.13,-132.36 104.33,-140.36 109.93,-140.36\"/></g><g id=\"fig-e76757fedf-mul\" class=\"node\" data-part=\"mul\"><path fill=\"#ffffff\" stroke=\"#1f2a24\" stroke-width=\"1.4\" d=\"M94.39,-29.59C94.39,-29.59 9.86,-29.59 9.86,-29.59 4.93,-29.59 0,-24.66 0,-19.73 0,-19.73 0,-9.86 0,-9.86 0,-4.93 4.93,0 9.86,0 9.86,0 94.39,0 94.39,0 99.32,0 104.26,-4.93 104.26,-9.86 104.26,-9.86 104.26,-19.73 104.26,-19.73 104.26,-24.66 99.32,-29.59 94.39,-29.59\"/><text text-anchor=\"middle\" x=\"52.13\" y=\"-11.2\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" font-size=\"12.00\" fill=\"#1f2a24\">n × fact(n &#45; 1)</text></g><g id=\"fig-e76757fedf-yes\" class=\"edge\" data-part=\"yes\"><path fill=\"none\" stroke=\"#3a4540\" stroke-width=\"1.3\" d=\"M93.25,-79.28C85.18,-66.83 75.02,-51.14 66.82,-38.48\"/><polygon fill=\"#3a4540\" stroke=\"#3a4540\" stroke-width=\"1.3\" points=\"69.27,-37.12 62.57,-31.92 64.57,-40.16 69.27,-37.12\"/><text text-anchor=\"middle\" x=\"84.64\" y=\"-48.59\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" font-size=\"10.00\" fill=\"#1f2a24\">yes</text></g><g id=\"fig-e76757fedf-one\" class=\"node\" data-part=\"one\"><path fill=\"#fbf3e2\" stroke=\"#b7862b\" stroke-width=\"3\" d=\"M185.24,-29.59C185.24,-29.59 139.02,-29.59 139.02,-29.59 134.08,-29.59 129.15,-24.66 129.15,-19.73 129.15,-19.73 129.15,-9.86 129.15,-9.86 129.15,-4.93 134.08,0 139.02,0 139.02,0 185.24,0 185.24,0 190.17,0 195.1,-4.93 195.1,-9.86 195.1,-9.86 195.1,-19.73 195.1,-19.73 195.1,-24.66 190.17,-29.59 185.24,-29.59\"/><text text-anchor=\"middle\" x=\"162.13\" y=\"-11.2\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" font-size=\"12.00\" fill=\"#1f2a24\">Return 1</text></g><g id=\"fig-e76757fedf-no\" class=\"edge\" data-part=\"no\"><path fill=\"none\" stroke=\"#b7862b\" stroke-width=\"2.6\" d=\"M121.01,-79.28C128.54,-67.65 137.89,-53.21 145.78,-41.04\"/><polygon fill=\"#b7862b\" stroke=\"#b7862b\" stroke-width=\"2.6\" points=\"148.1,-42.6 150.1,-34.36 143.4,-39.55 148.1,-42.6\"/><text text-anchor=\"middle\" x=\"147.77\" y=\"-48.59\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" font-size=\"10.00\" fill=\"#1f2a24\">no</text></g></g></svg>",
   "description": "A flowchart with 4 boxes: Start; Is n > 1?; n × fact(n - 1); Return 1. Start leads to Is n > 1?; Is n > 1? leads to n × fact(n - 1) (yes); Is n > 1? leads to Return 1 (no). Step 2 of 2: n is 1, so return 1."
  }
 ],
 "stack": [
  {
   "caption": "main calls fact(3).",
   "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 340 250\" width=\"340\" height=\"250\" role=\"img\" aria-labelledby=\"fig-77f7d57295-title fig-77f7d57295-desc\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" id=\"fig-77f7d57295\"><title id=\"fig-77f7d57295-title\">fact(3)</title><desc id=\"fig-77f7d57295-desc\">A stack of 2 frames, bottom to top: main, fact(3) (n = 3). The top frame is fact(3). main calls fact(3).</desc><rect x=\"0\" y=\"0\" width=\"340\" height=\"250\" fill=\"#FFFFFF\"/><text x=\"170\" y=\"20\" font-size=\"15\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\" font-weight=\"600\">fact(3)</text><polyline points=\"40,36 40,196 300,196 300,36\" fill=\"none\" stroke=\"#3A4540\" stroke-width=\"2\"/><g id=\"fig-77f7d57295-main\" data-part=\"main\"><rect x=\"48\" y=\"142\" width=\"244\" height=\"46\" rx=\"8\" fill=\"#FFFFFF\" fill-opacity=\"1\" stroke=\"#1F2A24\" stroke-width=\"1.6\"/><text x=\"170\" y=\"165\" font-size=\"14\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\" font-weight=\"700\">main</text></g><g id=\"fig-77f7d57295-f3\" data-part=\"f3\"><rect x=\"48\" y=\"90\" width=\"244\" height=\"46\" rx=\"8\" fill=\"#2F6B4F\" fill-opacity=\"0.9\" stroke=\"#2F6B4F\" stroke-width=\"1.6\"/><text x=\"170\" y=\"107\" font-size=\"14\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#FFFFFF\" font-weight=\"700\">fact(3)</text><text x=\"170\" y=\"124\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#FFFFFF\">n = 3</text></g><text x=\"170\" y=\"212\" font-size=\"10\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">Bottom of the stack</text><text x=\"170\" y=\"236\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\">main calls fact(3).</text></svg>",
   "description": "A stack of 2 frames, bottom to top: main, fact(3) (n = 3). The top frame is fact(3). main calls fact(3)."
  },
  {
   "caption": "fact(3) needs fact(2), so it waits.",
   "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 340 250\" width=\"340\" height=\"250\" role=\"img\" aria-labelledby=\"fig-77f7d57295-title fig-77f7d57295-desc\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" id=\"fig-77f7d57295\"><title id=\"fig-77f7d57295-title\">fact(3)</title><desc id=\"fig-77f7d57295-desc\">A stack of 3 frames, bottom to top: main, fact(3), fact(2) (n = 2). The top frame is fact(2). fact(3) needs fact(2), so it waits.</desc><rect x=\"0\" y=\"0\" width=\"340\" height=\"250\" fill=\"#FFFFFF\"/><text x=\"170\" y=\"20\" font-size=\"15\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\" font-weight=\"600\">fact(3)</text><polyline points=\"40,36 40,196 300,196 300,36\" fill=\"none\" stroke=\"#3A4540\" stroke-width=\"2\"/><g id=\"fig-77f7d57295-main\" data-part=\"main\"><rect x=\"48\" y=\"142\" width=\"244\" height=\"46\" rx=\"8\" fill=\"#FFFFFF\" fill-opacity=\"1\" stroke=\"#1F2A24\" stroke-width=\"1.6\"/><text x=\"170\" y=\"165\" font-size=\"14\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\" font-weight=\"700\">main</text></g><g id=\"fig-77f7d57295-f3\" data-part=\"f3\"><rect x=\"48\" y=\"90\" width=\"244\" height=\"46\" rx=\"8\" fill=\"#FFFFFF\" fill-opacity=\"1\" stroke=\"#1F2A24\" stroke-width=\"1.6\"/><text x=\"170\" y=\"113\" font-size=\"14\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\" font-weight=\"700\">fact(3)</text></g><g id=\"fig-77f7d57295-f2\" data-part=\"f2\"><rect x=\"48\" y=\"38\" width=\"244\" height=\"46\" rx=\"8\" fill=\"#2F6B4F\" fill-opacity=\"0.9\" stroke=\"#2F6B4F\" stroke-width=\"1.6\"/><text x=\"170\" y=\"55\" font-size=\"14\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#FFFFFF\" font-weight=\"700\">fact(2)</text><text x=\"170\" y=\"72\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#FFFFFF\">n = 2</text></g><text x=\"170\" y=\"212\" font-size=\"10\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">Bottom of the stack</text><text x=\"170\" y=\"236\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\">fact(3) needs fact(2), so it waits.</text></svg>",
   "description": "A stack of 3 frames, bottom to top: main, fact(3), fact(2) (n = 2). The top frame is fact(2). fact(3) needs fact(2), so it waits."
  },
  {
   "caption": "fact(2) returns 2 and is popped.",
   "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 340 250\" width=\"340\" height=\"250\" role=\"img\" aria-labelledby=\"fig-77f7d57295-title fig-77f7d57295-desc\" font-family=\"Manrope, Noto Sans Devanagari, Noto Sans, system-ui, sans-serif\" id=\"fig-77f7d57295\"><title id=\"fig-77f7d57295-title\">fact(3)</title><desc id=\"fig-77f7d57295-desc\">A stack of 2 frames, bottom to top: main, fact(3) (returns 6). The top frame is fact(3). fact(2) returns 2 and is popped.</desc><rect x=\"0\" y=\"0\" width=\"340\" height=\"250\" fill=\"#FFFFFF\"/><text x=\"170\" y=\"20\" font-size=\"15\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\" font-weight=\"600\">fact(3)</text><polyline points=\"40,36 40,196 300,196 300,36\" fill=\"none\" stroke=\"#3A4540\" stroke-width=\"2\"/><g id=\"fig-77f7d57295-main\" data-part=\"main\"><rect x=\"48\" y=\"142\" width=\"244\" height=\"46\" rx=\"8\" fill=\"#FFFFFF\" fill-opacity=\"1\" stroke=\"#1F2A24\" stroke-width=\"1.6\"/><text x=\"170\" y=\"165\" font-size=\"14\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\" font-weight=\"700\">main</text></g><g id=\"fig-77f7d57295-f3\" data-part=\"f3\"><rect x=\"48\" y=\"90\" width=\"244\" height=\"46\" rx=\"8\" fill=\"#2F6B4F\" fill-opacity=\"0.9\" stroke=\"#2F6B4F\" stroke-width=\"1.6\"/><text x=\"170\" y=\"107\" font-size=\"14\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#FFFFFF\" font-weight=\"700\">fact(3)</text><text x=\"170\" y=\"124\" font-size=\"11\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#FFFFFF\">returns 6</text></g><text x=\"170\" y=\"212\" font-size=\"10\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#585C63\">Bottom of the stack</text><text x=\"170\" y=\"236\" font-size=\"12\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#1F2A24\">fact(2) returns 2 and is popped.</text></svg>",
   "description": "A stack of 2 frames, bottom to top: main, fact(3) (returns 6). The top frame is fact(3). fact(2) returns 2 and is popped."
  }
 ]
};

export const REFUSED = {
 "badSmiles": {
  "status": 400,
  "error": "The structure \"C1CC\" is not a molecule the chemistry engine can read: check the SMILES string."
 },
 "wrongFormula": {
  "status": 400,
  "error": "The formula given, C2H4O, does not match the structure drawn, which is C2H6O. Correct one of them."
 }
};

/** A figure stimulus as a phone gets it (figureForStudent): never the spec, never the steps. */
export const studentFigure = (name) => {
  const f = STAFF[name];
  return { kind: 'figure', type: f.type, title: f.title, svg: f.svg, description: f.description, table: f.table };
};

/** A lesson's figure step (figureWithSteps): the student view plus every step drawn. */
export const lessonFigure = (name) => ({ ...studentFigure(name), steps: FRAMES[name] ?? [] });

/** The projector's figure at a step (figureAtStep); 0 is the figure itself. */
export const projectorFigure = (name, step = 0) => {
  const f = STAFF[name];
  const at = step ? FRAMES[name][step - 1] : null;
  return {
    ...studentFigure(name),
    svg: at ? at.svg : f.svg,
    description: at ? at.description : f.description,
    step,
    stepCount: f.stepCount,
    caption: at ? at.caption : '',
  };
};
