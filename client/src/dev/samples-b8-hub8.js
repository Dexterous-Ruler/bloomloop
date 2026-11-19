// Replies from the batch 8 server (worktree b8-z2) on the hub harness, captured
// 2026-11-19 for the gallery. Development only; imported by dev/hub8.gallery.jsx.
// The harness has no model, so the Recursion lesson's concept sections were
// stored through the repo (scratchpad b6/b6server.mjs) and read back through the
// real route, as asha (English) and dev (Hindi). Regenerate with b6/mkfix.mjs.
//
// LESSON_SECTIONS      GET /api/hub/topics/:id/lesson, asha: lesson.sections available
// LESSON_SECTIONS_HI   the same as dev (हिन्दी): the sections' text translated, terms and code in English
// LESSON_NO_SECTIONS   the Functions lesson (slides only): sections.available false with its note
// NEXT_TOKEN           GET /api/hub/practice/next with its serveToken
// TOKEN_MISSING        the 409 for an answer without its serve token (POST /api/hub/practice/attempts)
// TOKEN_EXPIRED        the 409 sentence for one given too long ago (services/serveTokens.js)
// READY_OPEN8          GET /api/hub/getready/:id, asha's open check
// READY_COMPLETE8      asha's complete check: path.why with its source
// READY_ENDED          POST /api/hub/getready/:id/end, bilal: the check as it ended (endedEarly, note)

export const LESSON_SECTIONS = {
 "topic": {
  "id": "d43d3fc6ad093dc45bf2b188",
  "name": "Recursion",
  "nameHtml": "Recursion"
 },
 "lesson": {
  "id": "b9023bc3e54caf9372df01b9",
  "version": 2,
  "approvedAt": "2026-11-19T16:21:37.619Z",
  "label": "Made from your professor's slides with AI help, and checked by your professor.",
  "language": {
   "requested": "en",
   "language": "en",
   "translationId": null,
   "note": null
  },
  "steps": [
   {
    "type": "chunk",
    "cite": "Slide 4",
    "text": "Recursion\nA recursive function calls itself on a smaller input.\nfactorial(n) = n × factorial(n − 1), with factorial(0) = 1.",
    "html": "Recursion<br>A recursive function calls itself on a smaller input.<br>factorial(n) = n × factorial(n − 1), with factorial(0) = 1."
   },
   {
    "type": "questions",
    "cite": "Slide 4",
    "questions": [
     {
      "_id": "1c69998bf729a7707058b3aa",
      "text": "What does a recursive function do?",
      "bloom": "remember",
      "topic": "Recursion",
      "kind": "mcq",
      "source": "teacher",
      "options": [
       "Calls itself on a smaller input",
       "Calls only other functions",
       "Calls itself on the same input",
       "Nothing until it is imported"
      ],
      "rich": {},
      "provenance": {
       "by": "professor",
       "checked": true,
       "text": "Written by your professor."
      },
      "language": {
       "requested": "en",
       "language": "en",
       "translationId": null,
       "note": null
      },
      "hints": {
       "available": 1,
       "note": "Each hint you open is noted with your answer, and your professor can see how many you used. A hint never gives the answer away; your result comes after you answer."
      },
      "serveToken": "1795710280.hN99kazajpCBAyEhNKD0NJzx756C2M_yg_wHcleUjHg"
     },
     {
      "_id": "c7f9bf28d609f3e098c2fd8d",
      "text": "Every recursive function can also be written with a loop and a stack.",
      "bloom": "remember",
      "topic": "Recursion",
      "kind": "truefalse",
      "source": "teacher",
      "rich": {},
      "provenance": {
       "by": "professor",
       "checked": true,
       "text": "Written by your professor."
      },
      "language": {
       "requested": "en",
       "language": "en",
       "translationId": null,
       "note": null
      },
      "hints": {
       "available": 0,
       "note": "Your professor has not added hints to this question."
      },
      "serveToken": "1795710280.ew-yphVzMpJoXGjhaq-VJdi57u2xbrmaxfr0woQWKVI"
     },
     {
      "_id": "1737f3e55c3b7b73a62e0f1e",
      "text": "What does `f(3)` return? ```python def f(n): if n == 0: return 0 return n + f(n - 1) ```",
      "bloom": "remember",
      "topic": "Recursion",
      "kind": "mcq",
      "source": "teacher",
      "options": [
       "6",
       "3",
       "0",
       "It never returns"
      ],
      "rich": {},
      "provenance": {
       "by": "professor",
       "checked": true,
       "text": "Written by your professor."
      },
      "language": {
       "requested": "en",
       "language": "en",
       "translationId": null,
       "note": null
      },
      "hints": {
       "available": 1,
       "note": "Each hint you open is noted with your answer, and your professor can see how many you used. A hint never gives the answer away; your result comes after you answer."
      },
      "serveToken": "1795710280.nkFuYqf_-aE_9UX9_Ovj8fMBfKisFgxRH46xG7E78FA"
     },
     {
      "_id": "cf8bc2a0694556d187001f4a",
      "text": "Using $n! = n \\times (n-1)!$ and $0! = 1$, what is $4!$?",
      "bloom": "apply",
      "topic": "Recursion",
      "kind": "numeric",
      "source": "teacher",
      "unit": "",
      "rich": {
       "text": "Using <math><mrow><mi>n</mi><mo form=\"postfix\" stretchy=\"false\">!</mo><mo>=</mo><mi>n</mi><mo>×</mo><mrow><mo fence=\"true\" form=\"prefix\" stretchy=\"false\">(</mo><mi>n</mi><mo>−</mo><mn>1</mn><mo fence=\"true\" form=\"postfix\" stretchy=\"false\">)</mo></mrow><mo form=\"postfix\" stretchy=\"false\">!</mo></mrow></math> and <math><mrow><mn>0</mn><mo form=\"postfix\" stretchy=\"false\">!</mo><mo>=</mo><mn>1</mn></mrow></math>, what is <math><mrow><mn>4</mn><mo form=\"postfix\" stretchy=\"false\">!</mo></mrow></math>?"
      },
      "provenance": {
       "by": "professor",
       "checked": true,
       "text": "Written by your professor."
      },
      "language": {
       "requested": "en",
       "language": "en",
       "translationId": null,
       "note": null
      },
      "hints": {
       "available": 2,
       "note": "Each hint you open is noted with your answer, and your professor can see how many you used. A hint never gives the answer away; your result comes after you answer."
      },
      "serveToken": "1795710280.0m9sA_CMQCC3Hp1m849W76uQGZArzC9AjuH_e_TnuTQ"
     }
    ]
   }
  ],
  "sections": {
   "available": true,
   "label": "Written from your professor's slides with AI help, and checked by your professor.",
   "intro": {
    "text": "Recursion solves a problem by solving a smaller copy of the same problem, until the copy is small enough to answer directly. Every recursive function needs a base case that stops it and a step that moves towards it.",
    "html": "Recursion solves a problem by solving a smaller copy of the same problem, until the copy is small enough to answer directly. Every recursive function needs a base case that stops it and a step that moves towards it.",
    "slides": [
     3
    ],
    "cite": "Slide 3"
   },
   "facts": [
    {
     "kind": "why",
     "label": "Why it matters",
     "text": "Many structures in this course, such as trees, are defined in terms of smaller copies of themselves.",
     "html": "Many structures in this course, such as trees, are defined in terms of smaller copies of themselves.",
     "slides": [
      3
     ],
     "cite": "Slide 3"
    },
    {
     "kind": "where",
     "label": "Where it is used",
     "text": "Tree traversals, divide-and-conquer sorting and parsing all use recursion.",
     "html": "Tree traversals, divide-and-conquer sorting and parsing all use recursion.",
     "slides": [
      3,
      4
     ],
     "cite": "Slides 3 and 4"
    },
    {
     "kind": "connects",
     "label": "Connects to",
     "text": "Each call adds a frame to the call stack, which is why deep recursion can run out of memory.",
     "html": "Each call adds a frame to the call stack, which is why deep recursion can run out of memory.",
     "slides": [
      4
     ],
     "cite": "Slide 4"
    }
   ],
   "steps": [
    {
     "term": "Base case",
     "text": "The input small enough to answer without another call, such as factorial(0) = 1.",
     "html": "The input small enough to answer without another call, such as factorial(0) = 1.",
     "slides": [
      3
     ],
     "cite": "Slide 3"
    },
    {
     "term": "Recursive step",
     "text": "The function calls itself on a smaller input, such as n × factorial(n − 1).",
     "html": "The function calls itself on a smaller input, such as n × factorial(n − 1).",
     "slides": [
      3
     ],
     "cite": "Slide 3"
    },
    {
     "term": "Unwinding",
     "text": "Each call returns its value to the call that made it, building the answer on the way back.",
     "html": "Each call returns its value to the call that made it, building the answer on the way back.",
     "slides": [
      4
     ],
     "cite": "Slide 4"
    }
   ],
   "example": {
    "language": "python",
    "body": "def factorial(n):\n    if n == 0:\n        return 1\n    return n * factorial(n - 1)",
    "html": "<pre class=\"shiki shiki-themes github-light github-dark\" style=\"background-color:#fff;--shiki-dark-bg:#24292e;color:#24292e;--shiki-dark:#e1e4e8\" tabindex=\"0\"><code><span class=\"line\"><span style=\"color:#D73A49;--shiki-dark:#F97583\">def</span><span style=\"color:#6F42C1;--shiki-dark:#B392F0\"> factorial</span><span style=\"color:#24292E;--shiki-dark:#E1E4E8\">(n):</span></span>\n<span class=\"line\"><span style=\"color:#D73A49;--shiki-dark:#F97583\">    if</span><span style=\"color:#24292E;--shiki-dark:#E1E4E8\"> n </span><span style=\"color:#D73A49;--shiki-dark:#F97583\">==</span><span style=\"color:#005CC5;--shiki-dark:#79B8FF\"> 0</span><span style=\"color:#24292E;--shiki-dark:#E1E4E8\">:</span></span>\n<span class=\"line\"><span style=\"color:#D73A49;--shiki-dark:#F97583\">        return</span><span style=\"color:#005CC5;--shiki-dark:#79B8FF\"> 1</span></span>\n<span class=\"line\"><span style=\"color:#D73A49;--shiki-dark:#F97583\">    return</span><span style=\"color:#24292E;--shiki-dark:#E1E4E8\"> n </span><span style=\"color:#D73A49;--shiki-dark:#F97583\">*</span><span style=\"color:#24292E;--shiki-dark:#E1E4E8\"> factorial(n </span><span style=\"color:#D73A49;--shiki-dark:#F97583\">-</span><span style=\"color:#005CC5;--shiki-dark:#79B8FF\"> 1</span><span style=\"color:#24292E;--shiki-dark:#E1E4E8\">)</span></span></code></pre>",
    "caption": "factorial(4) makes four more calls before the base case answers, then multiplies on the way back.",
    "captionHtml": "factorial(4) makes four more calls before the base case answers, then multiplies on the way back.",
    "slides": [
     3
    ],
    "cite": "Slide 3"
   },
   "mistakes": [
    {
     "text": "Leaving out the base case, so the calls never stop.",
     "html": "Leaving out the base case, so the calls never stop.",
     "slides": [
      3
     ],
     "cite": "Slide 3"
    },
    {
     "text": "Calling the function on the same input, so it never gets closer to the base case.",
     "html": "Calling the function on the same input, so it never gets closer to the base case.",
     "slides": [
      3
     ],
     "cite": "Slide 3"
    }
   ]
  },
  "answering": true
 }
};

export const LESSON_SECTIONS_HI = {
 "topic": {
  "id": "d43d3fc6ad093dc45bf2b188",
  "name": "Recursion",
  "nameHtml": "Recursion"
 },
 "lesson": {
  "id": "b9023bc3e54caf9372df01b9",
  "version": 2,
  "approvedAt": "2026-11-19T16:21:37.619Z",
  "label": "Made from your professor's slides with AI help, and checked by your professor.",
  "language": {
   "requested": "hi",
   "language": "hi",
   "translationId": "157c7634d773463872139a2e",
   "note": null
  },
  "steps": [
   {
    "type": "chunk",
    "cite": "Slide 4",
    "text": "Recursion\nA recursive function calls itself on a smaller input.\nfactorial(n) = n × factorial(n − 1), with factorial(0) = 1.",
    "html": "Recursion<br>A recursive function calls itself on a smaller input.<br>factorial(n) = n × factorial(n − 1), with factorial(0) = 1."
   },
   {
    "type": "questions",
    "cite": "Slide 4",
    "questions": [
     {
      "_id": "1c69998bf729a7707058b3aa",
      "text": "recursive function क्या करता है?",
      "bloom": "remember",
      "topic": "Recursion",
      "kind": "mcq",
      "source": "teacher",
      "options": [
       "छोटे input पर खुद को call करता है",
       "केवल दूसरे functions को call करता है",
       "उसी input पर खुद को call करता है",
       "import होने तक कुछ नहीं करता"
      ],
      "rich": {},
      "provenance": {
       "by": "professor",
       "checked": true,
       "text": "Written by your professor."
      },
      "language": {
       "requested": "hi",
       "language": "hi",
       "translationId": "e924f1e1f7d6bd09d7d9812e",
       "note": null
      },
      "hints": {
       "available": 1,
       "note": "Each hint you open is noted with your answer, and your professor can see how many you used. A hint never gives the answer away; your result comes after you answer."
      },
      "serveToken": "1795710281.c8kccKMiHW36BhcKMAnbVUljeO0cbAV4vEC377NuHCM"
     },
     {
      "_id": "c7f9bf28d609f3e098c2fd8d",
      "text": "Every recursive function can also be written with a loop and a stack.",
      "bloom": "remember",
      "topic": "Recursion",
      "kind": "truefalse",
      "source": "teacher",
      "rich": {},
      "provenance": {
       "by": "professor",
       "checked": true,
       "text": "Written by your professor."
      },
      "language": {
       "requested": "hi",
       "language": "en",
       "translationId": null,
       "note": "This question is not in Hindi yet, so it is shown in English."
      },
      "hints": {
       "available": 0,
       "note": "Your professor has not added hints to this question."
      },
      "serveToken": "1795710281.AUSJE_-g8OOtHRoJQ5283NHu6LMpjj_G0qtIx5ggn4E"
     },
     {
      "_id": "1737f3e55c3b7b73a62e0f1e",
      "text": "What does `f(3)` return? ```python def f(n): if n == 0: return 0 return n + f(n - 1) ```",
      "bloom": "remember",
      "topic": "Recursion",
      "kind": "mcq",
      "source": "teacher",
      "options": [
       "6",
       "3",
       "0",
       "It never returns"
      ],
      "rich": {},
      "provenance": {
       "by": "professor",
       "checked": true,
       "text": "Written by your professor."
      },
      "language": {
       "requested": "hi",
       "language": "en",
       "translationId": null,
       "note": "This question is not in Hindi yet, so it is shown in English."
      },
      "hints": {
       "available": 2,
       "note": "Each hint you open is noted with your answer, and your professor can see how many you used. A hint never gives the answer away; your result comes after you answer."
      },
      "serveToken": "1795710281.E78lPy12C1H5_GiZ92ykIgsM7efFkETjcJ69hjiAFHk"
     },
     {
      "_id": "cf8bc2a0694556d187001f4a",
      "text": "$n! = n \\times (n-1)!$ और $0! = 1$ का उपयोग करके बताइए, $4!$ कितना है?",
      "bloom": "apply",
      "topic": "Recursion",
      "kind": "numeric",
      "source": "teacher",
      "unit": "",
      "rich": {
       "text": "<math><mrow><mi>n</mi><mo form=\"postfix\" stretchy=\"false\">!</mo><mo>=</mo><mi>n</mi><mo>×</mo><mrow><mo fence=\"true\" form=\"prefix\" stretchy=\"false\">(</mo><mi>n</mi><mo>−</mo><mn>1</mn><mo fence=\"true\" form=\"postfix\" stretchy=\"false\">)</mo></mrow><mo form=\"postfix\" stretchy=\"false\">!</mo></mrow></math> और <math><mrow><mn>0</mn><mo form=\"postfix\" stretchy=\"false\">!</mo><mo>=</mo><mn>1</mn></mrow></math> का उपयोग करके बताइए, <math><mrow><mn>4</mn><mo form=\"postfix\" stretchy=\"false\">!</mo></mrow></math> कितना है?"
      },
      "provenance": {
       "by": "professor",
       "checked": true,
       "text": "Written by your professor."
      },
      "language": {
       "requested": "hi",
       "language": "hi",
       "translationId": "95309b4e2a76cc8cf55c721f",
       "note": null
      },
      "hints": {
       "available": 3,
       "note": "Each hint you open is noted with your answer, and your professor can see how many you used. A hint never gives the answer away; your result comes after you answer."
      },
      "serveToken": "1795710281.MRN2GjlXfYpdj3bozY6PerldWWlhZcglzL4EHSZ4jro"
     }
    ]
   }
  ],
  "sections": {
   "available": true,
   "label": "Written from your professor's slides with AI help, and checked by your professor.",
   "intro": {
    "text": "Recursion किसी समस्या को उसी समस्या की एक छोटी copy हल करके हल करता है, जब तक copy इतनी छोटी न हो जाए कि उसका उत्तर सीधे दिया जा सके। हर recursive function को रुकने के लिए एक base case और उसकी ओर बढ़ने वाला एक step चाहिए।",
    "html": "Recursion किसी समस्या को उसी समस्या की एक छोटी copy हल करके हल करता है, जब तक copy इतनी छोटी न हो जाए कि उसका उत्तर सीधे दिया जा सके। हर recursive function को रुकने के लिए एक base case और उसकी ओर बढ़ने वाला एक step चाहिए।",
    "slides": [
     3
    ],
    "cite": "Slide 3"
   },
   "facts": [
    {
     "kind": "why",
     "label": "Why it matters",
     "text": "इस course की कई संरचनाएँ, जैसे trees, अपनी ही छोटी copies के रूप में परिभाषित होती हैं।",
     "html": "इस course की कई संरचनाएँ, जैसे trees, अपनी ही छोटी copies के रूप में परिभाषित होती हैं।",
     "slides": [
      3
     ],
     "cite": "Slide 3"
    },
    {
     "kind": "where",
     "label": "Where it is used",
     "text": "Tree traversals, divide-and-conquer sorting और parsing सभी recursion का उपयोग करते हैं।",
     "html": "Tree traversals, divide-and-conquer sorting और parsing सभी recursion का उपयोग करते हैं।",
     "slides": [
      3,
      4
     ],
     "cite": "Slides 3 and 4"
    },
    {
     "kind": "connects",
     "label": "Connects to",
     "text": "हर call call stack पर एक frame जोड़ता है, इसीलिए गहरी recursion में memory खत्म हो सकती है।",
     "html": "हर call call stack पर एक frame जोड़ता है, इसीलिए गहरी recursion में memory खत्म हो सकती है।",
     "slides": [
      4
     ],
     "cite": "Slide 4"
    }
   ],
   "steps": [
    {
     "term": "Base case",
     "text": "इतना छोटा input जिसका उत्तर बिना दूसरी call के दिया जा सके, जैसे factorial(0) = 1।",
     "html": "इतना छोटा input जिसका उत्तर बिना दूसरी call के दिया जा सके, जैसे factorial(0) = 1।",
     "slides": [
      3
     ],
     "cite": "Slide 3"
    },
    {
     "term": "Recursive step",
     "text": "function खुद को छोटे input पर call करता है, जैसे n × factorial(n − 1)।",
     "html": "function खुद को छोटे input पर call करता है, जैसे n × factorial(n − 1)।",
     "slides": [
      3
     ],
     "cite": "Slide 3"
    },
    {
     "term": "Unwinding",
     "text": "हर call अपना मान उस call को लौटाता है जिसने उसे बुलाया था, और लौटते समय उत्तर बनता है।",
     "html": "हर call अपना मान उस call को लौटाता है जिसने उसे बुलाया था, और लौटते समय उत्तर बनता है।",
     "slides": [
      4
     ],
     "cite": "Slide 4"
    }
   ],
   "example": {
    "language": "python",
    "body": "def factorial(n):\n    if n == 0:\n        return 1\n    return n * factorial(n - 1)",
    "html": "<pre class=\"shiki shiki-themes github-light github-dark\" style=\"background-color:#fff;--shiki-dark-bg:#24292e;color:#24292e;--shiki-dark:#e1e4e8\" tabindex=\"0\"><code><span class=\"line\"><span style=\"color:#D73A49;--shiki-dark:#F97583\">def</span><span style=\"color:#6F42C1;--shiki-dark:#B392F0\"> factorial</span><span style=\"color:#24292E;--shiki-dark:#E1E4E8\">(n):</span></span>\n<span class=\"line\"><span style=\"color:#D73A49;--shiki-dark:#F97583\">    if</span><span style=\"color:#24292E;--shiki-dark:#E1E4E8\"> n </span><span style=\"color:#D73A49;--shiki-dark:#F97583\">==</span><span style=\"color:#005CC5;--shiki-dark:#79B8FF\"> 0</span><span style=\"color:#24292E;--shiki-dark:#E1E4E8\">:</span></span>\n<span class=\"line\"><span style=\"color:#D73A49;--shiki-dark:#F97583\">        return</span><span style=\"color:#005CC5;--shiki-dark:#79B8FF\"> 1</span></span>\n<span class=\"line\"><span style=\"color:#D73A49;--shiki-dark:#F97583\">    return</span><span style=\"color:#24292E;--shiki-dark:#E1E4E8\"> n </span><span style=\"color:#D73A49;--shiki-dark:#F97583\">*</span><span style=\"color:#24292E;--shiki-dark:#E1E4E8\"> factorial(n </span><span style=\"color:#D73A49;--shiki-dark:#F97583\">-</span><span style=\"color:#005CC5;--shiki-dark:#79B8FF\"> 1</span><span style=\"color:#24292E;--shiki-dark:#E1E4E8\">)</span></span></code></pre>",
    "caption": "factorial(4) base case के उत्तर देने से पहले चार और calls करता है, फिर लौटते समय गुणा करता है।",
    "captionHtml": "factorial(4) base case के उत्तर देने से पहले चार और calls करता है, फिर लौटते समय गुणा करता है।",
    "slides": [
     3
    ],
    "cite": "Slide 3"
   },
   "mistakes": [
    {
     "text": "base case छोड़ देना, जिससे calls कभी नहीं रुकतीं।",
     "html": "base case छोड़ देना, जिससे calls कभी नहीं रुकतीं।",
     "slides": [
      3
     ],
     "cite": "Slide 3"
    },
    {
     "text": "function को उसी input पर call करना, जिससे वह base case के कभी करीब नहीं पहुँचता।",
     "html": "function को उसी input पर call करना, जिससे वह base case के कभी करीब नहीं पहुँचता।",
     "slides": [
      3
     ],
     "cite": "Slide 3"
    }
   ]
  },
  "answering": true
 }
};

export const LESSON_NO_SECTIONS = {
 "topic": {
  "id": "084306a5b935b3fa8be46c0a",
  "name": "Functions",
  "nameHtml": "Functions"
 },
 "lesson": {
  "id": "61b76fa1c5f2698ca2aa87d8",
  "version": 1,
  "approvedAt": "2026-11-05T03:30:04.121Z",
  "label": "Your professor's slides, in short steps.",
  "language": {
   "requested": "en",
   "language": "en",
   "translationId": null,
   "note": null
  },
  "steps": [
   {
    "type": "chunk",
    "cite": "Slide 1",
    "text": "Functions\nA function takes inputs and returns a value.\nCalling $f(x)$ runs its body with $x$ bound to the argument.",
    "html": "Functions<br>A function takes inputs and returns a value.<br>Calling <math><mrow><mi>f</mi><mrow><mo fence=\"true\" form=\"prefix\" stretchy=\"false\">(</mo><mi>x</mi><mo fence=\"true\" form=\"postfix\" stretchy=\"false\">)</mo></mrow></mrow></math> runs its body with <math><mi>x</mi></math> bound to the argument."
   },
   {
    "type": "questions",
    "cite": "Slide 1",
    "questions": [
     {
      "_id": "2f882877c9295cb59c48786f",
      "text": "What does a function return to its caller?",
      "bloom": "remember",
      "topic": "Functions",
      "kind": "mcq",
      "source": "teacher",
      "options": [
       "A value",
       "A slide",
       "Its own source code",
       "Nothing, ever"
      ],
      "rich": {},
      "provenance": {
       "by": "professor",
       "checked": true,
       "text": "Written by your professor."
      },
      "language": {
       "requested": "en",
       "language": "en",
       "translationId": null,
       "note": null
      },
      "hints": {
       "available": 0,
       "note": "Your professor has not added hints to this question."
      },
      "serveToken": "1795710281.MftZatFa-gdd694OvMGfDlTwJ0gF61SQcAL2wifqnok"
     },
     {
      "_id": "f13cea1fba6de41de2a55d05",
      "text": "A function's parameters are bound to the arguments when it is called.",
      "bloom": "remember",
      "topic": "Functions",
      "kind": "truefalse",
      "source": "teacher",
      "rich": {},
      "provenance": {
       "by": "professor",
       "checked": true,
       "text": "Written by your professor."
      },
      "language": {
       "requested": "en",
       "language": "en",
       "translationId": null,
       "note": null
      },
      "hints": {
       "available": 0,
       "note": "Your professor has not added hints to this question."
      },
      "serveToken": "1795710281.Dv3uKI3q2m3XhSyp5jzUAXyH0gulnUZNq7GOUMqzl2I"
     },
     {
      "_id": "0820b59f408099217e0249ad",
      "text": "If $f(x) = x^2 + 1$, what is $f(3)$?",
      "bloom": "remember",
      "topic": "Functions",
      "kind": "mcq",
      "source": "teacher",
      "options": [
       "$10$",
       "$9$",
       "$7$",
       "$4$"
      ],
      "rich": {
       "text": "If <math><mrow><mi>f</mi><mrow><mo fence=\"true\" form=\"prefix\" stretchy=\"false\">(</mo><mi>x</mi><mo fence=\"true\" form=\"postfix\" stretchy=\"false\">)</mo></mrow><mo>=</mo><msup><mi>x</mi><mn class=\"tml-sml-pad\">2</mn></msup><mo>+</mo><mn>1</mn></mrow></math>, what is <math><mrow><mi>f</mi><mrow><mo fence=\"true\" form=\"prefix\" stretchy=\"false\">(</mo><mn>3</mn><mo fence=\"true\" form=\"postfix\" stretchy=\"false\">)</mo></mrow></mrow></math>?",
       "options": [
        "<math><mn>10</mn></math>",
        "<math><mn>9</mn></math>",
        "<math><mn>7</mn></math>",
        "<math><mn>4</mn></math>"
       ]
      },
      "provenance": {
       "by": "professor",
       "checked": true,
       "text": "Written by your professor."
      },
      "language": {
       "requested": "en",
       "language": "en",
       "translationId": null,
       "note": null
      },
      "hints": {
       "available": 0,
       "note": "Your professor has not added hints to this question."
      },
      "serveToken": "1795710281.MOM1DJTCQuvk0QqiNYM3ojY0gtkBMzuTxPP9hBXG-YU"
     },
     {
      "_id": "f9fdab29448b2f21c01cb592",
      "text": "A function can be called more than once in a program.",
      "bloom": "remember",
      "topic": "Functions",
      "kind": "truefalse",
      "source": "teacher",
      "rich": {},
      "provenance": {
       "by": "professor",
       "checked": true,
       "text": "Written by your professor."
      },
      "language": {
       "requested": "en",
       "language": "en",
       "translationId": null,
       "note": null
      },
      "hints": {
       "available": 0,
       "note": "Your professor has not added hints to this question."
      },
      "serveToken": "1795710281.ILNyQG25LNhJwdBwLycWLrmeqYhH3jZYeYtLvT8n0Zw"
     }
    ]
   }
  ],
  "sections": {
   "available": false,
   "note": "This lesson is your professor's slides in short steps, with nothing added to them yet.",
   "intro": null,
   "facts": [],
   "steps": [],
   "example": null,
   "mistakes": []
  },
  "answering": true
 }
};

export const NEXT_TOKEN = {
 "mode": "practice",
 "language": "en",
 "translationId": null,
 "languageNote": null,
 "question": {
  "_id": "8472ea4ba3ed7575465630e0",
  "text": "What is a base case?",
  "bloom": "remember",
  "topic": "Base case",
  "kind": "mcq",
  "source": "teacher",
  "options": [
   "A case answered without a recursive call",
   "The first line of a program",
   "The largest possible input",
   "A case that always calls itself"
  ],
  "provenance": {
   "by": "professor",
   "checked": true,
   "text": "Written by your professor."
  },
  "rich": {}
 },
 "serveToken": "1795710281.jD8VZ95g3NAAIOG1TjXrH4x3J_ij1hRZjIpODRX_mJY",
 "topic": {
  "id": "c859028e84325a0b3167ec8d",
  "name": "Base case",
  "nameHtml": "Base case",
  "chapter": {
   "id": "cb8595a32ebe128971244058",
   "title": "Recursion and the call stack",
   "titleHtml": "Recursion and the call stack"
  }
 },
 "topics": [
  {
   "id": "c859028e84325a0b3167ec8d",
   "name": "Base case",
   "nameHtml": "Base case",
   "chapter": {
    "id": "cb8595a32ebe128971244058",
    "title": "Recursion and the call stack",
    "titleHtml": "Recursion and the call stack"
   }
  }
 ],
 "why": "Chosen to be about the right challenge for you now, from your 3 answers on this topic.",
 "hints": {
  "available": 1,
  "note": "Each hint you open is noted with your answer, and your professor can see how many you used. A hint never gives the answer away; your result comes after you answer."
 }
};

export const TOKEN_MISSING = {
 "status": 409,
 "message": "This answer was not sent with the question it answers, so it was not taken. Open the question again and answer it there."
};

export const TOKEN_EXPIRED = {
 "status": 409,
 "message": "This question was given to you too long ago to be answered now, so this answer was not taken. Open the question again and answer it there."
};

export const READY_OPEN8 = {
 "check": {
  "id": "af18194d13f49f266673973c",
  "clientRunId": "asha-check-bst-00001",
  "startedAt": "2026-11-18T12:30:00.005Z",
  "endedAt": null,
  "status": "open",
  "asked": 1,
  "maxQuestions": 12,
  "rule": "The check asks at most 12 questions, about the topics this one needs first, nearest first. Two right answers in a row on a topic make it Ready and two wrong make it Needs review; after one of each, a third question decides (two of three right is Ready). A topic you have already mastered in practice is Ready without asking. A topic the check could not decide is Not sure yet."
 },
 "target": {
  "id": "f68d9c64a3574014e4d09350",
  "name": "Binary search trees",
  "nameHtml": "Binary search trees",
  "chapter": {
   "id": "26522565b608f516f483a19c",
   "title": "Trees",
   "titleHtml": "Trees"
  }
 },
 "prerequisites": [
  {
   "topic": {
    "id": "7e55b778fe1932bd8bea3d46",
    "name": "Binary trees",
    "nameHtml": "Binary trees",
    "chapter": {
     "id": "26522565b608f516f483a19c",
     "title": "Trees",
     "titleHtml": "Trees"
    }
   },
   "depth": 1,
   "status": "asking",
   "outcome": null,
   "label": null,
   "answers": 1,
   "right": 1,
   "source": "check",
   "provisional": true,
   "sentence": "Being checked now: you got 1 of 1 right so far."
  }
 ],
 "sentence": "Checking the topics \"Binary search trees\" needs first: 1 question asked of at most 12.",
 "question": {
  "question": {
   "_id": "0f569a8d9883d484dc85a51e",
   "text": "Which of these are binary trees?",
   "bloom": "analyse",
   "topic": "Binary trees",
   "kind": "multi",
   "source": "teacher",
   "options": [
    "A single node",
    "An empty tree",
    "A node with three children",
    "A chain where each node has one child",
    "A graph with a cycle"
   ],
   "provenance": {
    "by": "professor",
    "checked": true,
    "text": "Written by your professor."
   },
   "rich": {}
  },
  "language": "en",
  "translationId": null,
  "languageNote": null,
  "topic": {
   "id": "7e55b778fe1932bd8bea3d46",
   "name": "Binary trees",
   "nameHtml": "Binary trees"
  },
  "why": "Checking \"Binary trees\", which \"Binary search trees\" needs first.",
  "hints": {
   "available": 0,
   "note": "No hints in a Get Ready check: it finds out what you already know."
  }
 }
};

export const READY_COMPLETE8 = {
 "check": {
  "id": "3f9586fe96c666afde08b4eb",
  "clientRunId": "asha-check-recursion-trees",
  "startedAt": "2026-11-16T12:30:00.003Z",
  "endedAt": "2026-11-16T12:30:00.136Z",
  "status": "complete",
  "asked": 9,
  "maxQuestions": 12,
  "rule": "The check asks at most 12 questions, about the topics this one needs first, nearest first. Two right answers in a row on a topic make it Ready and two wrong make it Needs review; after one of each, a third question decides (two of three right is Ready). A topic you have already mastered in practice is Ready without asking. A topic the check could not decide is Not sure yet."
 },
 "target": {
  "id": "cd1b8f1c62e4a832dedea6c1",
  "name": "Recursion trees",
  "nameHtml": "Recursion trees",
  "chapter": {
   "id": "cb8595a32ebe128971244058",
   "title": "Recursion and the call stack",
   "titleHtml": "Recursion and the call stack"
  }
 },
 "prerequisites": [
  {
   "topic": {
    "id": "d43d3fc6ad093dc45bf2b188",
    "name": "Recursion",
    "nameHtml": "Recursion",
    "chapter": {
     "id": "cb8595a32ebe128971244058",
     "title": "Recursion and the call stack",
     "titleHtml": "Recursion and the call stack"
    }
   },
   "depth": 1,
   "status": "decided",
   "outcome": "needs-review",
   "label": "Needs review",
   "answers": 2,
   "right": 0,
   "source": "check",
   "provisional": false,
   "sentence": "Needs review: you got 0 of 2 right."
  },
  {
   "topic": {
    "id": "fc6119c628515a057f584359",
    "name": "The call stack",
    "nameHtml": "The call stack",
    "chapter": {
     "id": "cb8595a32ebe128971244058",
     "title": "Recursion and the call stack",
     "titleHtml": "Recursion and the call stack"
    }
   },
   "depth": 2,
   "status": "decided",
   "outcome": "ready",
   "label": "Ready",
   "answers": 3,
   "right": 2,
   "source": "check",
   "provisional": false,
   "sentence": "Ready: you got 2 of 3 right."
  },
  {
   "topic": {
    "id": "c859028e84325a0b3167ec8d",
    "name": "Base case",
    "nameHtml": "Base case",
    "chapter": {
     "id": "cb8595a32ebe128971244058",
     "title": "Recursion and the call stack",
     "titleHtml": "Recursion and the call stack"
    }
   },
   "depth": 2,
   "status": "decided",
   "outcome": "ready",
   "label": "Ready",
   "answers": 2,
   "right": 2,
   "source": "check",
   "provisional": false,
   "sentence": "Ready: you got 2 of 2 right."
  },
  {
   "topic": {
    "id": "084306a5b935b3fa8be46c0a",
    "name": "Functions",
    "nameHtml": "Functions",
    "chapter": {
     "id": "cb8595a32ebe128971244058",
     "title": "Recursion and the call stack",
     "titleHtml": "Recursion and the call stack"
    }
   },
   "depth": 3,
   "status": "decided",
   "outcome": "ready",
   "label": "Ready",
   "answers": 2,
   "right": 2,
   "source": "check",
   "provisional": false,
   "sentence": "Ready: you got 2 of 2 right."
  },
  {
   "topic": {
    "id": "5f88106a0016899cd605731b",
    "name": "Loops",
    "nameHtml": "Loops",
    "chapter": {
     "id": "c68a5f451d7426d6d7b1bced",
     "title": "Programming basics (last semester)",
     "titleHtml": "Programming basics (last semester)"
    }
   },
   "depth": 4,
   "status": "decided",
   "outcome": "not-sure",
   "label": "Not sure yet",
   "answers": 0,
   "right": 0,
   "source": "none",
   "provisional": true,
   "sentence": "Not sure yet: it is in material that is not on your classes in the hub, so the check could not ask about it."
  }
 ],
 "sentence": "1 prerequisite needs review first; the refresher path goes through it and then to \"Recursion trees\". 1 is not sure yet; practising it helps too.",
 "question": null,
 "path": {
  "why": {
   "sentence": "\"Recursion\" was 0 of 2 in the check, so it is on your path. \"The call stack\" was 2 of 3 in the check, so it is marked Ready and you can skip it. \"Base case\" was 2 of 2 in the check, so it is marked Ready and you can skip it. \"Functions\" was 2 of 2 in the check, so it is marked Ready and you can skip it.",
   "changes": [
    {
     "topicId": "d43d3fc6ad093dc45bf2b188",
     "name": "Recursion",
     "change": "needs-review",
     "evidence": "getready",
     "answers": 2,
     "right": 0,
     "sentence": "\"Recursion\" was 0 of 2 in the check, so it is on your path."
    },
    {
     "topicId": "fc6119c628515a057f584359",
     "name": "The call stack",
     "change": "ready",
     "evidence": "getready",
     "answers": 3,
     "right": 2,
     "sentence": "\"The call stack\" was 2 of 3 in the check, so it is marked Ready and you can skip it."
    },
    {
     "topicId": "c859028e84325a0b3167ec8d",
     "name": "Base case",
     "change": "ready",
     "evidence": "getready",
     "answers": 2,
     "right": 2,
     "sentence": "\"Base case\" was 2 of 2 in the check, so it is marked Ready and you can skip it."
    },
    {
     "topicId": "084306a5b935b3fa8be46c0a",
     "name": "Functions",
     "change": "ready",
     "evidence": "getready",
     "answers": 2,
     "right": 2,
     "sentence": "\"Functions\" was 2 of 2 in the check, so it is marked Ready and you can skip it."
    }
   ],
   "source": {
    "kind": "getready",
    "label": "Your Get Ready check · 16 Nov, and practice since",
    "at": "2026-11-16T12:30:00.136Z"
   }
  },
  "steps": [
   {
    "topicId": "d43d3fc6ad093dc45bf2b188",
    "name": "Recursion",
    "depth": 1,
    "why": "On your path because you got 0 of 2 right on it in the Get Ready check. \"Recursion trees\" builds on it directly.",
    "status": "in-progress",
    "answers": 2,
    "right": 1,
    "sentence": "Since the check: 1 of 2 answers right. A step is done when your answers on it since the check are two right in a row, or two right of your last three. A question you answer again counts once you have answered every other question on the topic since.",
    "topic": {
     "id": "d43d3fc6ad093dc45bf2b188",
     "name": "Recursion",
     "nameHtml": "Recursion"
    }
   }
  ],
  "target": {
   "topicId": "cd1b8f1c62e4a832dedea6c1",
   "name": "Recursion trees",
   "status": "waiting",
   "sentence": "The goal: start \"Recursion trees\" once the steps above are done.",
   "topic": {
    "id": "cd1b8f1c62e4a832dedea6c1",
    "name": "Recursion trees",
    "nameHtml": "Recursion trees"
   }
  },
  "next": "d43d3fc6ad093dc45bf2b188",
  "done": 0,
  "total": 1,
  "rule": "A step is done when your answers on it since the check are two right in a row, or two right of your last three. A question you answer again counts once you have answered every other question on the topic since."
 }
};

export const READY_ENDED = {
 "changed": true,
 "check": {
  "id": "f5574fe1b9a7245038f47eef",
  "clientRunId": "b6-bilal-check-0001",
  "startedAt": "2026-11-19T16:40:16.065Z",
  "endedAt": "2026-11-19T16:40:16.144Z",
  "status": "complete",
  "asked": 1,
  "maxQuestions": 12,
  "rule": "The check asks at most 12 questions, about the topics this one needs first, nearest first. Two right answers in a row on a topic make it Ready and two wrong make it Needs review; after one of each, a third question decides (two of three right is Ready). A topic you have already mastered in practice is Ready without asking. A topic the check could not decide is Not sure yet.",
  "endedEarly": true,
  "note": "You ended this check early. The topics it had not decided are Not sure yet, and the question it was asking is open again in practice."
 },
 "target": {
  "id": "d43d3fc6ad093dc45bf2b188",
  "name": "Recursion",
  "nameHtml": "Recursion",
  "chapter": {
   "id": "cb8595a32ebe128971244058",
   "title": "Recursion and the call stack",
   "titleHtml": "Recursion and the call stack"
  }
 },
 "prerequisites": [
  {
   "topic": {
    "id": "fc6119c628515a057f584359",
    "name": "The call stack",
    "nameHtml": "The call stack",
    "chapter": {
     "id": "cb8595a32ebe128971244058",
     "title": "Recursion and the call stack",
     "titleHtml": "Recursion and the call stack"
    }
   },
   "depth": 1,
   "status": "decided",
   "outcome": "not-sure",
   "label": "Not sure yet",
   "answers": 1,
   "right": 0,
   "source": "check",
   "provisional": true,
   "sentence": "Not sure yet: you got 0 of 1 right when the check ended."
  },
  {
   "topic": {
    "id": "c859028e84325a0b3167ec8d",
    "name": "Base case",
    "nameHtml": "Base case",
    "chapter": {
     "id": "cb8595a32ebe128971244058",
     "title": "Recursion and the call stack",
     "titleHtml": "Recursion and the call stack"
    }
   },
   "depth": 1,
   "status": "decided",
   "outcome": "not-sure",
   "label": "Not sure yet",
   "answers": 0,
   "right": 0,
   "source": "none",
   "provisional": true,
   "sentence": "Not sure yet: the check ended before it could ask about this topic."
  },
  {
   "topic": {
    "id": "084306a5b935b3fa8be46c0a",
    "name": "Functions",
    "nameHtml": "Functions",
    "chapter": {
     "id": "cb8595a32ebe128971244058",
     "title": "Recursion and the call stack",
     "titleHtml": "Recursion and the call stack"
    }
   },
   "depth": 2,
   "status": "decided",
   "outcome": "not-sure",
   "label": "Not sure yet",
   "answers": 0,
   "right": 0,
   "source": "none",
   "provisional": true,
   "sentence": "Not sure yet: the check ended before it could ask about this topic."
  },
  {
   "topic": {
    "id": "5f88106a0016899cd605731b",
    "name": "Loops",
    "nameHtml": "Loops",
    "chapter": {
     "id": "c68a5f451d7426d6d7b1bced",
     "title": "Programming basics (last semester)",
     "titleHtml": "Programming basics (last semester)"
    }
   },
   "depth": 3,
   "status": "decided",
   "outcome": "not-sure",
   "label": "Not sure yet",
   "answers": 0,
   "right": 0,
   "source": "none",
   "provisional": true,
   "sentence": "Not sure yet: it is in material that is not on your classes in the hub, so the check could not ask about it."
  }
 ],
 "sentence": "Nothing the check could decide needs review: you can start \"Recursion\". 4 are not sure yet; practising them helps too.",
 "question": null,
 "path": {
  "why": {
   "sentence": "The check found nothing you need to review first.",
   "changes": [],
   "source": {
    "kind": "getready",
    "label": "Your Get Ready check · 19 Nov, and practice since",
    "at": "2026-11-19T16:40:16.144Z"
   }
  },
  "steps": [],
  "target": {
   "topicId": "d43d3fc6ad093dc45bf2b188",
   "name": "Recursion",
   "status": "ready",
   "sentence": "Nothing needs review first: start \"Recursion\" now.",
   "topic": {
    "id": "d43d3fc6ad093dc45bf2b188",
    "name": "Recursion",
    "nameHtml": "Recursion"
   }
  },
  "next": "d43d3fc6ad093dc45bf2b188",
  "done": 0,
  "total": 0,
  "rule": "A step is done when your answers on it since the check are two right in a row, or two right of your last three. A question you answer again counts once you have answered every other question on the topic since."
 }
};
