/**
 * Replies for a topic, its lesson, practice, review sets, hints and answers,
 * captured from the hub harness (the real server code, the in-process store,
 * no model) on 2026-11-19: GETs as asha (and dev, who reads Hindi), hints and
 * answers as bilal. Written by the HS3 builder's scratchpad script
 * (hs3/capture.mjs, hs3/samples.mjs); edit by hand only what is marked.
 * Development only: imported by dev/hubtopic.gallery.jsx alone.
 */

/** GET /hub/topics/721870b77c4b6229593c997d (asha) */
export const TOPIC_REPLY = {
  "topic": {
    "id": "721870b77c4b6229593c997d",
    "name": "Recursion",
    "nameHtml": "Recursion",
    "chapter": {
      "id": "a42f9dfa54c87d20bf72261b",
      "title": "Recursion and the call stack",
      "titleHtml": "Recursion and the call stack"
    }
  },
  "prerequisites": [
    {
      "id": "e512651f20354a8945385751",
      "name": "The call stack",
      "nameHtml": "The call stack",
      "chapter": {
        "id": "a42f9dfa54c87d20bf72261b",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 1,
      "via": [
        "721870b77c4b6229593c997d"
      ],
      "onYourClasses": true
    },
    {
      "id": "12bc867a4943ed7e68d6d225",
      "name": "Base case",
      "nameHtml": "Base case",
      "chapter": {
        "id": "a42f9dfa54c87d20bf72261b",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 1,
      "via": [
        "721870b77c4b6229593c997d"
      ],
      "onYourClasses": true
    },
    {
      "id": "26661816288ea315652efaba",
      "name": "Functions",
      "nameHtml": "Functions",
      "chapter": {
        "id": "a42f9dfa54c87d20bf72261b",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 2,
      "via": [
        "e512651f20354a8945385751"
      ],
      "onYourClasses": true
    },
    {
      "id": "c7ded5d61c8a8a68489adce9",
      "name": "Loops",
      "nameHtml": "Loops",
      "chapter": {
        "id": "f491be5f460d5b853be26618",
        "title": "Programming basics (last semester)",
        "titleHtml": "Programming basics (last semester)"
      },
      "depth": 3,
      "via": [
        "26661816288ea315652efaba"
      ],
      "onYourClasses": false
    }
  ],
  "leadsTo": [
    {
      "id": "ec9414d6221be5eab7331746",
      "name": "Recursion trees",
      "nameHtml": "Recursion trees",
      "chapter": {
        "id": "a42f9dfa54c87d20bf72261b",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 1,
      "via": [
        "721870b77c4b6229593c997d"
      ],
      "onYourClasses": true
    },
    {
      "id": "66b0482a223f23d746733183",
      "name": "Traversals",
      "nameHtml": "Traversals",
      "chapter": {
        "id": "e109e59b67d5ff63badef3ce",
        "title": "Trees",
        "titleHtml": "Trees"
      },
      "depth": 1,
      "via": [
        "721870b77c4b6229593c997d"
      ],
      "onYourClasses": true
    },
    {
      "id": "dcfec25b2a5b4168a99487c3",
      "name": "Memoisation",
      "nameHtml": "Memoisation",
      "chapter": {
        "id": "a42f9dfa54c87d20bf72261b",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 2,
      "via": [
        "ec9414d6221be5eab7331746"
      ],
      "onYourClasses": true
    }
  ],
  "note": "Prerequisites are the topics your professor confirmed are needed first, nearest first."
};

/** GET /hub/topics/:id for Functions: nothing needed first (asha) */
export const TOPIC_FIRST_REPLY = {
  "topic": {
    "id": "26661816288ea315652efaba",
    "name": "Functions",
    "nameHtml": "Functions",
    "chapter": {
      "id": "a42f9dfa54c87d20bf72261b",
      "title": "Recursion and the call stack",
      "titleHtml": "Recursion and the call stack"
    }
  },
  "prerequisites": [
    {
      "id": "c7ded5d61c8a8a68489adce9",
      "name": "Loops",
      "nameHtml": "Loops",
      "chapter": {
        "id": "f491be5f460d5b853be26618",
        "title": "Programming basics (last semester)",
        "titleHtml": "Programming basics (last semester)"
      },
      "depth": 1,
      "via": [
        "26661816288ea315652efaba"
      ],
      "onYourClasses": false
    }
  ],
  "leadsTo": [
    {
      "id": "e512651f20354a8945385751",
      "name": "The call stack",
      "nameHtml": "The call stack",
      "chapter": {
        "id": "a42f9dfa54c87d20bf72261b",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 1,
      "via": [
        "26661816288ea315652efaba"
      ],
      "onYourClasses": true
    },
    {
      "id": "721870b77c4b6229593c997d",
      "name": "Recursion",
      "nameHtml": "Recursion",
      "chapter": {
        "id": "a42f9dfa54c87d20bf72261b",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 2,
      "via": [
        "e512651f20354a8945385751"
      ],
      "onYourClasses": true
    },
    {
      "id": "ec9414d6221be5eab7331746",
      "name": "Recursion trees",
      "nameHtml": "Recursion trees",
      "chapter": {
        "id": "a42f9dfa54c87d20bf72261b",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 3,
      "via": [
        "721870b77c4b6229593c997d"
      ],
      "onYourClasses": true
    },
    {
      "id": "66b0482a223f23d746733183",
      "name": "Traversals",
      "nameHtml": "Traversals",
      "chapter": {
        "id": "e109e59b67d5ff63badef3ce",
        "title": "Trees",
        "titleHtml": "Trees"
      },
      "depth": 3,
      "via": [
        "721870b77c4b6229593c997d"
      ],
      "onYourClasses": true
    },
    {
      "id": "dcfec25b2a5b4168a99487c3",
      "name": "Memoisation",
      "nameHtml": "Memoisation",
      "chapter": {
        "id": "a42f9dfa54c87d20bf72261b",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 4,
      "via": [
        "ec9414d6221be5eab7331746"
      ],
      "onYourClasses": true
    }
  ],
  "note": "Prerequisites are the topics your professor confirmed are needed first, nearest first."
};

/** GET /hub/topics/:id/lesson: the Recursion lesson, slides only (asha, English) */
export const LESSON_REPLY = {
  "topic": {
    "id": "721870b77c4b6229593c997d",
    "name": "Recursion",
    "nameHtml": "Recursion"
  },
  "lesson": {
    "id": "5482a2bbd602474d87a8f022",
    "version": 1,
    "approvedAt": "2026-11-19T14:45:24.192Z",
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
        "cite": "Slide 4",
        "text": "Recursion\nA recursive function calls itself on a smaller input.\nfactorial(n) = n × factorial(n − 1), with factorial(0) = 1.",
        "html": "Recursion<br>A recursive function calls itself on a smaller input.<br>factorial(n) = n × factorial(n − 1), with factorial(0) = 1."
      },
      {
        "type": "questions",
        "cite": "Slide 4",
        "questions": [
          {
            "_id": "185cdf7667460951dba16eba",
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
            }
          },
          {
            "_id": "c3c76907f3a0a757538f1dc6",
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
            }
          },
          {
            "_id": "8b7492a492ce9fb5fbdbb2b6",
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
            }
          },
          {
            "_id": "c9eb9efb583e74c67dd1fa5a",
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
            }
          }
        ]
      }
    ],
    "answering": true
  }
};

/** The same lesson as dev reads it: Hindi, with two questions still in English */
export const LESSON_HI_REPLY = {
  "topic": {
    "id": "721870b77c4b6229593c997d",
    "name": "Recursion",
    "nameHtml": "Recursion"
  },
  "lesson": {
    "id": "5482a2bbd602474d87a8f022",
    "version": 1,
    "approvedAt": "2026-11-19T14:45:24.192Z",
    "label": "Your professor's slides, in short steps.",
    "language": {
      "requested": "hi",
      "language": "hi",
      "translationId": "7752971a9d4f6e95c8f5e081",
      "note": null
    },
    "steps": [
      {
        "type": "chunk",
        "cite": "Slide 4",
        "text": "Recursion\nrecursive function खुद को छोटे input पर call करता है।\nfactorial(n) = n × factorial(n − 1), और factorial(0) = 1।",
        "html": "Recursion<br>recursive function खुद को छोटे input पर call करता है।<br>factorial(n) = n × factorial(n − 1), और factorial(0) = 1।"
      },
      {
        "type": "questions",
        "cite": "Slide 4",
        "questions": [
          {
            "_id": "185cdf7667460951dba16eba",
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
              "translationId": "f204f05e10ee886d39af0332",
              "note": null
            },
            "hints": {
              "available": 1,
              "note": "Each hint you open is noted with your answer, and your professor can see how many you used. A hint never gives the answer away; your result comes after you answer."
            }
          },
          {
            "_id": "c3c76907f3a0a757538f1dc6",
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
            }
          },
          {
            "_id": "8b7492a492ce9fb5fbdbb2b6",
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
            }
          },
          {
            "_id": "c9eb9efb583e74c67dd1fa5a",
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
              "translationId": "0ddcacf5afa9d06db1a844c3",
              "note": null
            },
            "hints": {
              "available": 3,
              "note": "Each hint you open is noted with your answer, and your professor can see how many you used. A hint never gives the answer away; your result comes after you answer."
            }
          }
        ]
      }
    ],
    "answering": true
  }
};

/** No lesson published (Base case) */
export const LESSON_NONE_REPLY = {
  "topic": {
    "id": "12bc867a4943ed7e68d6d225",
    "name": "Base case",
    "nameHtml": "Base case"
  },
  "lesson": null,
  "empty": "Your professor has not published a lesson on this topic yet."
};

/** GET /hub/progress (asha) */
export const PROGRESS_REPLY = {
  "notice": "Your professor can see your progress in the hub: the topics you practise and how you are doing on them.",
  "basis": "Each estimate rests on your answers in the hub. Your answers in class rooms do not change it; the ones you got wrong show in your error log, marked \"From class\".",
  "states": {
    "not-started": "Not started",
    "not-sure": "Not sure yet",
    "in-progress": "In progress",
    "mastered": "Mastered",
    "needs-review": "Needs review"
  },
  "counts": {
    "not-started": 5,
    "not-sure": 1,
    "in-progress": 3,
    "mastered": 1,
    "needs-review": 1
  },
  "topics": [
    {
      "id": "26661816288ea315652efaba",
      "name": "Functions",
      "nameHtml": "Functions",
      "chapter": {
        "id": "a42f9dfa54c87d20bf72261b",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "classIds": [
        "14ec2d8889d591f095e0e63e"
      ],
      "practiceQuestions": 8,
      "state": {
        "state": "mastered",
        "label": "Mastered",
        "answers": 6,
        "attempts": 6,
        "provisional": false,
        "pRight": 0.93,
        "outOf10": 9,
        "estimateState": "mastered",
        "sentence": "Mastered: from your 6 answers, you would likely get about 9 in 10 typical questions on this topic right.",
        "review": {
          "dueAt": "2026-11-27T14:45:24.970Z",
          "due": false,
          "when": "on 2026-11-27",
          "sessions": 1,
          "lastRating": "easy"
        }
      }
    },
    {
      "id": "e512651f20354a8945385751",
      "name": "The call stack",
      "nameHtml": "The call stack",
      "chapter": {
        "id": "a42f9dfa54c87d20bf72261b",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "classIds": [
        "14ec2d8889d591f095e0e63e"
      ],
      "practiceQuestions": 6,
      "state": {
        "state": "in-progress",
        "label": "In progress",
        "answers": 5,
        "attempts": 5,
        "provisional": false,
        "pRight": 0.61,
        "outOf10": 6,
        "estimateState": "in-progress",
        "sentence": "In progress: from your 5 answers, you would likely get about 6 in 10 typical questions on this topic right. Mastered means about 8 in 10, from at least 5 answers.",
        "review": {
          "dueAt": "2026-11-19T14:50:55.005Z",
          "due": false,
          "when": "in 5 minutes",
          "sessions": 1,
          "lastRating": "hard"
        }
      }
    },
    {
      "id": "12bc867a4943ed7e68d6d225",
      "name": "Base case",
      "nameHtml": "Base case",
      "chapter": {
        "id": "a42f9dfa54c87d20bf72261b",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "classIds": [
        "14ec2d8889d591f095e0e63e"
      ],
      "practiceQuestions": 6,
      "state": {
        "state": "not-sure",
        "label": "Not sure yet",
        "answers": 2,
        "attempts": 2,
        "provisional": true,
        "pRight": null,
        "outOf10": null,
        "estimateState": "not-sure",
        "sentence": "Not sure yet: this rests on 2 answers. After 3 answers you get a first estimate.",
        "review": {
          "dueAt": "2026-11-19T14:55:24.818Z",
          "due": false,
          "when": "in 9 minutes",
          "sessions": 1,
          "lastRating": "good"
        }
      }
    },
    {
      "id": "721870b77c4b6229593c997d",
      "name": "Recursion",
      "nameHtml": "Recursion",
      "chapter": {
        "id": "a42f9dfa54c87d20bf72261b",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "classIds": [
        "14ec2d8889d591f095e0e63e"
      ],
      "practiceQuestions": 6,
      "state": {
        "state": "needs-review",
        "label": "Needs review",
        "answers": 4,
        "attempts": 4,
        "provisional": false,
        "pRight": 0.39,
        "outOf10": 3,
        "estimateState": "in-progress",
        "sentence": "Due for review: a short practice set now helps you keep this topic. In progress: from your 4 answers, you would likely get about 3 in 10 typical questions on this topic right. Mastered means about 8 in 10, from at least 5 answers.",
        "review": {
          "dueAt": "2026-11-19T14:46:25.103Z",
          "due": true,
          "when": "now",
          "sessions": 1,
          "lastRating": "again"
        }
      }
    },
    {
      "id": "ec9414d6221be5eab7331746",
      "name": "Recursion trees",
      "nameHtml": "Recursion trees",
      "chapter": {
        "id": "a42f9dfa54c87d20bf72261b",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "classIds": [
        "14ec2d8889d591f095e0e63e"
      ],
      "practiceQuestions": 5,
      "state": {
        "state": "not-started",
        "label": "Not started",
        "answers": 0,
        "attempts": 0,
        "provisional": true,
        "pRight": null,
        "outOf10": null,
        "estimateState": "not-started",
        "sentence": "You have not practised this topic yet.",
        "review": {
          "dueAt": null,
          "due": false,
          "when": "",
          "sessions": 0,
          "lastRating": null
        }
      }
    },
    {
      "id": "dcfec25b2a5b4168a99487c3",
      "name": "Memoisation",
      "nameHtml": "Memoisation",
      "chapter": {
        "id": "a42f9dfa54c87d20bf72261b",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "classIds": [
        "14ec2d8889d591f095e0e63e"
      ],
      "practiceQuestions": 5,
      "state": {
        "state": "not-started",
        "label": "Not started",
        "answers": 0,
        "attempts": 0,
        "provisional": true,
        "pRight": null,
        "outOf10": null,
        "estimateState": "not-started",
        "sentence": "You have not practised this topic yet.",
        "review": {
          "dueAt": null,
          "due": false,
          "when": "",
          "sessions": 0,
          "lastRating": null
        }
      }
    },
    {
      "id": "77fdf54bcbec4b90d300e9c2",
      "name": "Binary trees",
      "nameHtml": "Binary trees",
      "chapter": {
        "id": "e109e59b67d5ff63badef3ce",
        "title": "Trees",
        "titleHtml": "Trees"
      },
      "classIds": [
        "14ec2d8889d591f095e0e63e"
      ],
      "practiceQuestions": 6,
      "state": {
        "state": "in-progress",
        "label": "In progress",
        "answers": 4,
        "attempts": 4,
        "provisional": false,
        "pRight": 0.7,
        "outOf10": 7,
        "estimateState": "in-progress",
        "sentence": "In progress: from your 4 answers, you would likely get about 7 in 10 typical questions on this topic right. Mastered means about 8 in 10, from at least 5 answers.",
        "review": {
          "dueAt": "2026-11-19T14:50:55.220Z",
          "due": false,
          "when": "in 5 minutes",
          "sessions": 1,
          "lastRating": "hard"
        }
      }
    },
    {
      "id": "66b0482a223f23d746733183",
      "name": "Traversals",
      "nameHtml": "Traversals",
      "chapter": {
        "id": "e109e59b67d5ff63badef3ce",
        "title": "Trees",
        "titleHtml": "Trees"
      },
      "classIds": [
        "14ec2d8889d591f095e0e63e"
      ],
      "practiceQuestions": 5,
      "state": {
        "state": "in-progress",
        "label": "In progress",
        "answers": 3,
        "attempts": 3,
        "provisional": false,
        "pRight": 0.85,
        "outOf10": 8,
        "estimateState": "in-progress",
        "sentence": "In progress: from your 3 answers, you would likely get about 8 in 10 typical questions on this topic right. Mastered needs at least 5 answers, so a few more will show it.",
        "review": {
          "dueAt": "2026-11-19T14:55:25.164Z",
          "due": false,
          "when": "in 9 minutes",
          "sessions": 1,
          "lastRating": "good"
        }
      }
    },
    {
      "id": "9c43ede3da66bef030f4b0d0",
      "name": "Binary search trees",
      "nameHtml": "Binary search trees",
      "chapter": {
        "id": "e109e59b67d5ff63badef3ce",
        "title": "Trees",
        "titleHtml": "Trees"
      },
      "classIds": [
        "14ec2d8889d591f095e0e63e"
      ],
      "practiceQuestions": 5,
      "state": {
        "state": "not-started",
        "label": "Not started",
        "answers": 0,
        "attempts": 0,
        "provisional": true,
        "pRight": null,
        "outOf10": null,
        "estimateState": "not-started",
        "sentence": "You have not practised this topic yet.",
        "review": {
          "dueAt": null,
          "due": false,
          "when": "",
          "sessions": 0,
          "lastRating": null
        }
      }
    },
    {
      "id": "cbd245d1eaccc17d687f97be",
      "name": "Big-O notation",
      "nameHtml": "Big-O notation",
      "chapter": {
        "id": "7db8bf80bf5ae792b6f99bb1",
        "title": "Complexity",
        "titleHtml": "Complexity"
      },
      "classIds": [
        "14ec2d8889d591f095e0e63e"
      ],
      "practiceQuestions": 2,
      "state": {
        "state": "not-started",
        "label": "Not started",
        "answers": 0,
        "attempts": 0,
        "provisional": true,
        "pRight": null,
        "outOf10": null,
        "estimateState": "not-started",
        "sentence": "You have not practised this topic yet.",
        "review": {
          "dueAt": null,
          "due": false,
          "when": "",
          "sessions": 0,
          "lastRating": null
        }
      }
    },
    {
      "id": "3a0dab8d404fedda5f3eac4a",
      "name": "Counting steps",
      "nameHtml": "Counting steps",
      "chapter": {
        "id": "7db8bf80bf5ae792b6f99bb1",
        "title": "Complexity",
        "titleHtml": "Complexity"
      },
      "classIds": [
        "14ec2d8889d591f095e0e63e"
      ],
      "practiceQuestions": 1,
      "state": {
        "state": "not-started",
        "label": "Not started",
        "answers": 0,
        "attempts": 0,
        "provisional": true,
        "pRight": null,
        "outOf10": null,
        "estimateState": "not-started",
        "sentence": "You have not practised this topic yet.",
        "review": {
          "dueAt": null,
          "due": false,
          "when": "",
          "sessions": 0,
          "lastRating": null
        }
      }
    }
  ]
};

/** GET /hub/practice/next?topicId= (asha, Recursion) */
export const NEXT_REPLY = {
  "mode": "practice",
  "language": "en",
  "translationId": null,
  "languageNote": null,
  "question": {
    "_id": "0130c4d24666f96725b1cfc0",
    "text": "The recursive case of $n!$ calls the factorial on $n$ minus ____.",
    "bloom": "apply",
    "topic": "Recursion",
    "kind": "blank",
    "source": "teacher",
    "blankCount": 1,
    "provenance": {
      "by": "professor",
      "checked": true,
      "text": "Written by your professor."
    },
    "rich": {
      "text": "The recursive case of <math><mrow><mi>n</mi><mo form=\"postfix\" stretchy=\"false\">!</mo></mrow></math> calls the factorial on <math><mi>n</mi></math> minus ____."
    }
  },
  "topic": {
    "id": "721870b77c4b6229593c997d",
    "name": "Recursion",
    "nameHtml": "Recursion",
    "chapter": {
      "id": "a42f9dfa54c87d20bf72261b",
      "title": "Recursion and the call stack",
      "titleHtml": "Recursion and the call stack"
    }
  },
  "topics": [
    {
      "id": "721870b77c4b6229593c997d",
      "name": "Recursion",
      "nameHtml": "Recursion",
      "chapter": {
        "id": "a42f9dfa54c87d20bf72261b",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      }
    }
  ],
  "why": "Chosen to be about the right challenge for you now, from your 4 answers on this topic.",
  "hints": {
    "available": 0,
    "note": "Your professor has not added hints to this question."
  }
};

/** The same as dev: a reviewed Hindi translation */
export const NEXT_HI_REPLY = {
  "mode": "practice",
  "language": "hi",
  "translationId": "f204f05e10ee886d39af0332",
  "languageNote": null,
  "question": {
    "_id": "185cdf7667460951dba16eba",
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
    "provenance": {
      "by": "professor",
      "checked": true,
      "text": "Written by your professor."
    },
    "rich": {}
  },
  "topic": {
    "id": "721870b77c4b6229593c997d",
    "name": "Recursion",
    "nameHtml": "Recursion",
    "chapter": {
      "id": "a42f9dfa54c87d20bf72261b",
      "title": "Recursion and the call stack",
      "titleHtml": "Recursion and the call stack"
    }
  },
  "topics": [
    {
      "id": "721870b77c4b6229593c997d",
      "name": "Recursion",
      "nameHtml": "Recursion",
      "chapter": {
        "id": "a42f9dfa54c87d20bf72261b",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      }
    }
  ],
  "why": "Chosen to be about the right challenge for you now, from your 5 answers on this topic.",
  "hints": {
    "available": 1,
    "note": "Each hint you open is noted with your answer, and your professor can see how many you used. A hint never gives the answer away; your result comes after you answer."
  }
};

/** A review set across two topics (asha) */
export const NEXT_REVIEW_REPLY = {
  "mode": "review",
  "language": "en",
  "translationId": null,
  "languageNote": null,
  "question": {
    "_id": "21410c72aa54e3c6b30fe986",
    "text": "Which of these are kept in a stack frame?",
    "bloom": "analyse",
    "topic": "The call stack",
    "kind": "multi",
    "source": "teacher",
    "options": [
      "The call's arguments",
      "Its local variables",
      "Where to return to",
      "The program's source file",
      "Every object on the heap"
    ],
    "provenance": {
      "by": "professor",
      "checked": true,
      "text": "Written by your professor."
    },
    "rich": {}
  },
  "topic": {
    "id": "e512651f20354a8945385751",
    "name": "The call stack",
    "nameHtml": "The call stack",
    "chapter": {
      "id": "a42f9dfa54c87d20bf72261b",
      "title": "Recursion and the call stack",
      "titleHtml": "Recursion and the call stack"
    }
  },
  "topics": [
    {
      "id": "721870b77c4b6229593c997d",
      "name": "Recursion",
      "nameHtml": "Recursion",
      "chapter": {
        "id": "a42f9dfa54c87d20bf72261b",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      }
    },
    {
      "id": "e512651f20354a8945385751",
      "name": "The call stack",
      "nameHtml": "The call stack",
      "chapter": {
        "id": "a42f9dfa54c87d20bf72261b",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      }
    }
  ],
  "why": "Chosen to be about the right challenge for you now, from your 5 answers on this topic.",
  "hints": {
    "available": 0,
    "note": "Your professor has not added hints to this question."
  },
  "setSize": 5
};

/** Every question closed for now: asha has an open self-test on Binary search trees */
export const NEXT_CLOSED_REPLY = {
  "mode": "practice",
  "question": null,
  "topics": [
    {
      "id": "9c43ede3da66bef030f4b0d0",
      "name": "Binary search trees",
      "nameHtml": "Binary search trees",
      "chapter": {
        "id": "e109e59b67d5ff63badef3ce",
        "title": "Trees",
        "titleHtml": "Trees"
      }
    }
  ],
  "message": "Every question you could practise here is closed for now: being asked in class, on a self-test you have not handed in, or the one your Get Ready check is asking. Come back once that is done."
};

/** A kind the room phone draws (bilal, Traversals) */
export const NEXT_PHONE_REPLY = {
  "mode": "practice",
  "language": "en",
  "translationId": null,
  "languageNote": null,
  "question": {
    "_id": "f471492012bbf4d97b9cbcd6",
    "text": "In-order visits the ____ subtree, then the ____, then the ____ subtree.",
    "bloom": "apply",
    "topic": "Traversals",
    "kind": "dropdown",
    "source": "teacher",
    "blankCount": 3,
    "gaps": [
      {
        "options": [
          "parent",
          "left",
          "right"
        ]
      },
      {
        "options": [
          "node",
          "root's parent",
          "leaf"
        ]
      },
      {
        "options": [
          "right",
          "left",
          "parent"
        ]
      }
    ],
    "provenance": {
      "by": "professor",
      "checked": true,
      "text": "Written by your professor."
    },
    "rich": {}
  },
  "topic": {
    "id": "66b0482a223f23d746733183",
    "name": "Traversals",
    "nameHtml": "Traversals",
    "chapter": {
      "id": "e109e59b67d5ff63badef3ce",
      "title": "Trees",
      "titleHtml": "Trees"
    }
  },
  "topics": [
    {
      "id": "66b0482a223f23d746733183",
      "name": "Traversals",
      "nameHtml": "Traversals",
      "chapter": {
        "id": "e109e59b67d5ff63badef3ce",
        "title": "Trees",
        "titleHtml": "Trees"
      }
    }
  ],
  "why": "You have not practised this topic yet, so this question starts near its middle.",
  "hints": {
    "available": 0,
    "note": "Your professor has not added hints to this question."
  }
};

/** The response sent for it */
export const PHONE_RESPONSE = [
  0,
  0,
  0
];

/** POST /hub/practice/attempts for it: partly right */
export const ATTEMPT_PHONE_REPLY = {
  "attempt": {
    "id": "23cb80fa3607d8ea05ff4be4",
    "attemptId": "hs3-mwnny3di-ph",
    "mode": "practice",
    "createdAt": "2026-11-19T14:46:29.285Z",
    "language": "en",
    "hintsUsed": 0
  },
  "duplicate": false,
  "correct": false,
  "score": 0.667,
  "detail": "2/3 gaps",
  "solution": [
    1,
    0,
    0
  ],
  "explanation": null,
  "optionFeedback": [],
  "topic": {
    "id": "66b0482a223f23d746733183",
    "name": "Traversals",
    "nameHtml": "Traversals",
    "chapter": {
      "id": "e109e59b67d5ff63badef3ce",
      "title": "Trees",
      "titleHtml": "Trees"
    },
    "state": {
      "state": "not-sure",
      "label": "Not sure yet",
      "answers": 1,
      "attempts": 1,
      "provisional": true,
      "pRight": null,
      "outOf10": null,
      "estimateState": "not-sure",
      "sentence": "Not sure yet: this rests on 1 answer. After 3 answers you get a first estimate.",
      "review": {
        "dueAt": "2026-11-19T14:47:29.285Z",
        "due": false,
        "when": "in 1 minute",
        "sessions": 1,
        "lastRating": "again"
      }
    }
  }
};

/** POST /hub/practice/hints, step 1 of R1 (bilal) */
export const HINT_REPLY = {
  "hint": {
    "position": 1,
    "kind": "nudge",
    "label": "A nudge",
    "text": "Look at what the function calls, and on what input.",
    "html": "Look at what the function calls, and on what input.",
    "cite": "Slide 4",
    "by": "professor",
    "byLabel": "Written by your professor.",
    "language": "en"
  },
  "hintsUsed": 1,
  "remaining": 0,
  "why": "The hints start with a small nudge. Ask for the next one whenever you want it.",
  "note": "Each hint you open is noted with your answer, and your professor can see how many you used. A hint never gives the answer away; your result comes after you answer.",
  "duplicate": false
};

/** Step 2 of R1: none left */
export const HINT_NONE_REPLY = {
  "hint": null,
  "hintsUsed": 1,
  "remaining": 0,
  "why": "The hints start with a small nudge. Ask for the next one whenever you want it.",
  "note": "Each hint you open is noted with your answer, and your professor can see how many you used. A hint never gives the answer away; your result comes after you answer.",
  "message": "That was the last hint for this question. Try your answer now.",
  "duplicate": false
};

/** GET /hub/practice/hints after two of R2's three hints: what a reload shows */
export const HINTS_OPENED_REPLY = {
  "hints": [
    {
      "position": 1,
      "kind": "nudge",
      "label": "A nudge",
      "text": "Start from the base case: $0! = 1$.",
      "html": "Start from the base case: <math><mrow><mn>0</mn><mo form=\"postfix\" stretchy=\"false\">!</mo><mo>=</mo><mn>1</mn></mrow></math>.",
      "cite": "Slide 4",
      "by": "professor",
      "byLabel": "Written by your professor.",
      "language": "en"
    },
    {
      "position": 2,
      "kind": "strategy",
      "label": "A way in",
      "text": "Work upward one step at a time: $1!$, then $2!$, then $3!$.",
      "html": "Work upward one step at a time: <math><mrow><mn>1</mn><mo form=\"postfix\" stretchy=\"false\">!</mo></mrow></math>, then <math><mrow><mn>2</mn><mo form=\"postfix\" stretchy=\"false\">!</mo></mrow></math>, then <math><mrow><mn>3</mn><mo form=\"postfix\" stretchy=\"false\">!</mo></mrow></math>.",
      "cite": "Slide 4",
      "by": "professor",
      "byLabel": "Written by your professor.",
      "language": "en"
    }
  ],
  "hintsUsed": 2,
  "remaining": 1,
  "why": "The hints start with a small nudge. Ask for the next one whenever you want it.",
  "note": "Each hint you open is noted with your answer, and your professor can see how many you used. A hint never gives the answer away; your result comes after you answer."
};

/** POST /hub/practice/attempts: R1 answered with option 1, after one hint (bilal) */
export const ATTEMPT_WRONG_REPLY = {
  "attempt": {
    "id": "c17a3f62674c7b9ebce07742",
    "attemptId": "hs3-mwnny3di-r1",
    "mode": "practice",
    "createdAt": "2026-11-19T14:46:29.323Z",
    "language": "en",
    "hintsUsed": 1
  },
  "duplicate": false,
  "correct": false,
  "score": 0,
  "detail": "",
  "solution": 0,
  "explanation": {
    "text": "A recursive function solves a problem by calling itself on a smaller version of it, until it reaches the base case.",
    "textHtml": "A recursive function solves a problem by calling itself on a smaller version of it, until it reaches the base case.",
    "by": "professor",
    "label": "Written by your professor.",
    "note": "Shown after you answer.",
    "language": {
      "requested": "en",
      "language": "en",
      "translationId": null,
      "note": null
    }
  },
  "optionFeedback": [
    {
      "option": "Calls only other functions",
      "text": "A function that only calls others is not recursive: recursion means it calls itself.",
      "html": "A function that only calls others is not recursive: recursion means it calls itself.",
      "cite": "Slide 4",
      "by": "professor",
      "byLabel": "Written by your professor.",
      "language": {
        "requested": "en",
        "language": "en",
        "translationId": null,
        "note": null
      }
    }
  ],
  "topic": {
    "id": "721870b77c4b6229593c997d",
    "name": "Recursion",
    "nameHtml": "Recursion",
    "chapter": {
      "id": "a42f9dfa54c87d20bf72261b",
      "title": "Recursion and the call stack",
      "titleHtml": "Recursion and the call stack"
    },
    "state": {
      "state": "not-sure",
      "label": "Not sure yet",
      "answers": 1,
      "attempts": 1,
      "provisional": true,
      "pRight": null,
      "outOf10": null,
      "estimateState": "not-sure",
      "sentence": "Not sure yet: this rests on 1 answer. After 3 answers you get a first estimate.",
      "review": {
        "dueAt": "2026-11-19T14:47:29.323Z",
        "due": false,
        "when": "in 1 minute",
        "sessions": 1,
        "lastRating": "again"
      }
    }
  }
};

/** POST /hub/lessons/:id/questions/:id/attempts: R2 right */
export const LESSON_RIGHT_REPLY = {
  "attemptId": "hs3-mwnny3di-l2",
  "duplicate": false,
  "correct": true,
  "score": 1,
  "solution": 24,
  "optionFeedback": [],
  "language": "en"
};

/** The same answer resent: 200, duplicate */
export const LESSON_DUP_REPLY = {
  "attemptId": "hs3-mwnny3di-l2",
  "duplicate": true,
  "correct": true,
  "score": 1,
  "solution": 24,
  "optionFeedback": [],
  "language": "en",
  "note": "This answer was already saved; nothing was added."
};


/* Hand-written in the shape docs/API.md gives: the harness has no model, so
   its lessons are slides only and carry no worked example. */
export const EXAMPLE_STEP = {
  type: 'example',
  cite: 'Slide 4',
  label: 'Worked example, written with AI help and checked by your professor.',
  problem: 'Work out factorial(3) with the recursive rule.',
  problemHtml: 'Work out factorial(3) with the recursive rule.',
  steps: [
    { text: 'factorial(3) = 3 × factorial(2)', html: 'factorial(3) = 3 × factorial(2)' },
    { text: 'factorial(2) = 2 × factorial(1), and factorial(1) = 1 × factorial(0) = 1', html: 'factorial(2) = 2 × factorial(1), and factorial(1) = 1 × factorial(0) = 1' },
  ],
  answer: 'factorial(3) = 3 × 2 × 1 = 6',
  answerHtml: 'factorial(3) = 3 × 2 × 1 = 6',
};

/* Refusals as lib/api.js throws them, with the server's sentences. */
const refused = (status, error, extra = {}) => Object.assign(new Error(error), { status, body: { error }, ...extra });

export const NO_ACCOUNTS = refused(503, 'The learning hub needs student and staff accounts, and this server has none set up.');
export const SIGNED_OUT = refused(401, "Sign in to continue.");
export const NO_TOPIC = refused(404, 'That topic was not found.');
export const CLOSED_KEPT = refused(409, 'That question is on a self-test you have not handed in yet, so it stays closed here until you hand it in.', { kept: true, closed: true });
export const HINT_AFTER = refused(409, "That question is answered already, so its hints are closed. Your result is with your answer.");
