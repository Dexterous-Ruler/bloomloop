/**
 * Replies for the class page, a topic's prerequisites, reviews due and the
 * error log. Development only: imported by dev/hubmap.gallery.jsx alone.
 *
 * Real replies from the hub harness (:5050, seeded), read as asha and cara
 * on 2026-11-19 from one restart, so the ids match across them; written
 * here by the scratchpad's hs2/gen-samples.mjs. The last part is built from
 * docs/API.md for what the harness has no data for: a class with nothing
 * placed, a "From class" entry whose key is held, an order question, and the
 * refusals as lib/api.js throws them.
 */

/* eslint-disable */

/** GET /hub/classes/:id as asha: two units (one with a formula in its name), Other chapters. */
export const CLASS_REPLY = {
  "class": {
    "id": "fbdd64a4562261ddd302a9a1",
    "courseName": "Data Structures",
    "section": "SY CSE A",
    "termLabel": ""
  },
  "units": [
    {
      "id": "9c745c1d76ab058a12f69aa8",
      "name": "Unit 1: Recursion",
      "nameHtml": "Unit 1: Recursion",
      "chapters": [
        {
          "id": "c9bc3c27219a562cdb8403b7",
          "title": "Recursion and the call stack",
          "titleHtml": "Recursion and the call stack",
          "topics": [
            {
              "id": "4fbc6927fd78b9971585fa30",
              "name": "Functions",
              "nameHtml": "Functions"
            },
            {
              "id": "2cf5b50b3434c269001b79d1",
              "name": "The call stack",
              "nameHtml": "The call stack"
            },
            {
              "id": "fb9b037ef299ed01dc747566",
              "name": "Base case",
              "nameHtml": "Base case"
            },
            {
              "id": "4520c15ae70f4821ea9fc739",
              "name": "Recursion",
              "nameHtml": "Recursion"
            },
            {
              "id": "8a579f471e60eedf4ea6a156",
              "name": "Recursion trees",
              "nameHtml": "Recursion trees"
            },
            {
              "id": "80bb36aea49afcc256c6f466",
              "name": "Memoisation",
              "nameHtml": "Memoisation"
            }
          ]
        }
      ]
    },
    {
      "id": "fa44527607cf939a81a182fb",
      "name": "Unit 2: Trees, $O(\\log n)$ search",
      "nameHtml": "Unit 2: Trees, <math><mrow><mi>O</mi><mrow><mo fence=\"true\" form=\"prefix\" stretchy=\"false\">(</mo><mrow><mi>log</mi><mo>⁡</mo><mspace width=\"0.1667em\"></mspace></mrow><mi>n</mi><mo fence=\"true\" form=\"postfix\" stretchy=\"false\">)</mo></mrow></mrow></math> search",
      "chapters": [
        {
          "id": "f947d8971f85161093b98e60",
          "title": "Trees",
          "titleHtml": "Trees",
          "topics": [
            {
              "id": "3631acc31867b8e42aa8b992",
              "name": "Binary trees",
              "nameHtml": "Binary trees"
            },
            {
              "id": "91141b57a9dd84a21dcfff47",
              "name": "Traversals",
              "nameHtml": "Traversals"
            },
            {
              "id": "d03328eeeb3d1b1c75629a9c",
              "name": "Binary search trees",
              "nameHtml": "Binary search trees"
            }
          ]
        }
      ]
    }
  ],
  "otherChapters": {
    "label": "Other chapters",
    "chapters": [
      {
        "id": "026aac1bbe9ae5ded520b83c",
        "title": "Complexity",
        "titleHtml": "Complexity",
        "topics": [
          {
            "id": "e226653a34850ddd0150b3b6",
            "name": "Big-O notation",
            "nameHtml": "Big-O notation"
          },
          {
            "id": "0457ec366b25602c01538969",
            "name": "Counting steps",
            "nameHtml": "Counting steps"
          }
        ]
      }
    ]
  },
  "notice": "Your professor can see your progress in the hub: the topics you practise and how you are doing on them."
};

/** GET /hub/progress as asha some minutes after a restart: reviews due. */
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
    "in-progress": 1,
    "mastered": 1,
    "needs-review": 3
  },
  "topics": [
    {
      "id": "4fbc6927fd78b9971585fa30",
      "name": "Functions",
      "nameHtml": "Functions",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
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
          "dueAt": "2026-11-27T14:37:39.931Z",
          "due": false,
          "when": "on 2026-11-27",
          "sessions": 1,
          "lastRating": "easy"
        }
      }
    },
    {
      "id": "2cf5b50b3434c269001b79d1",
      "name": "The call stack",
      "nameHtml": "The call stack",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
      ],
      "practiceQuestions": 6,
      "state": {
        "state": "needs-review",
        "label": "Needs review",
        "answers": 5,
        "attempts": 5,
        "provisional": false,
        "pRight": 0.76,
        "outOf10": 7,
        "estimateState": "in-progress",
        "sentence": "Due for review: a short practice set now helps you keep this topic. In progress: from your 5 answers, you would likely get about 7 in 10 typical questions on this topic right. Mastered means about 8 in 10, from at least 5 answers.",
        "review": {
          "dueAt": "2026-11-19T14:43:09.965Z",
          "due": true,
          "when": "now",
          "sessions": 1,
          "lastRating": "hard"
        }
      }
    },
    {
      "id": "fb9b037ef299ed01dc747566",
      "name": "Base case",
      "nameHtml": "Base case",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
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
          "dueAt": "2026-11-19T14:47:39.736Z",
          "due": false,
          "when": "in 4 minutes",
          "sessions": 1,
          "lastRating": "good"
        }
      }
    },
    {
      "id": "4520c15ae70f4821ea9fc739",
      "name": "Recursion",
      "nameHtml": "Recursion",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
      ],
      "practiceQuestions": 6,
      "state": {
        "state": "needs-review",
        "label": "Needs review",
        "answers": 4,
        "attempts": 4,
        "provisional": false,
        "pRight": 0.44,
        "outOf10": 4,
        "estimateState": "in-progress",
        "sentence": "Due for review: a short practice set now helps you keep this topic. In progress: from your 4 answers, you would likely get about 4 in 10 typical questions on this topic right. Mastered means about 8 in 10, from at least 5 answers.",
        "review": {
          "dueAt": "2026-11-19T14:38:40.136Z",
          "due": true,
          "when": "now",
          "sessions": 1,
          "lastRating": "again"
        }
      }
    },
    {
      "id": "8a579f471e60eedf4ea6a156",
      "name": "Recursion trees",
      "nameHtml": "Recursion trees",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
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
      "id": "80bb36aea49afcc256c6f466",
      "name": "Memoisation",
      "nameHtml": "Memoisation",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
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
      "id": "3631acc31867b8e42aa8b992",
      "name": "Binary trees",
      "nameHtml": "Binary trees",
      "chapter": {
        "id": "f947d8971f85161093b98e60",
        "title": "Trees",
        "titleHtml": "Trees"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
      ],
      "practiceQuestions": 6,
      "state": {
        "state": "in-progress",
        "label": "In progress",
        "answers": 4,
        "attempts": 4,
        "provisional": false,
        "pRight": 0.82,
        "outOf10": 8,
        "estimateState": "in-progress",
        "sentence": "In progress: from your 4 answers, you would likely get about 8 in 10 typical questions on this topic right. Mastered needs at least 5 answers, so a few more will show it.",
        "review": {
          "dueAt": "2026-11-19T14:47:40.449Z",
          "due": false,
          "when": "in 4 minutes",
          "sessions": 1,
          "lastRating": "good"
        }
      }
    },
    {
      "id": "91141b57a9dd84a21dcfff47",
      "name": "Traversals",
      "nameHtml": "Traversals",
      "chapter": {
        "id": "f947d8971f85161093b98e60",
        "title": "Trees",
        "titleHtml": "Trees"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
      ],
      "practiceQuestions": 5,
      "state": {
        "state": "needs-review",
        "label": "Needs review",
        "answers": 3,
        "attempts": 3,
        "provisional": false,
        "pRight": 0.73,
        "outOf10": 7,
        "estimateState": "in-progress",
        "sentence": "Due for review: a short practice set now helps you keep this topic. In progress: from your 3 answers, you would likely get about 7 in 10 typical questions on this topic right. Mastered means about 8 in 10, from at least 5 answers.",
        "review": {
          "dueAt": "2026-11-19T14:43:10.353Z",
          "due": true,
          "when": "now",
          "sessions": 1,
          "lastRating": "hard"
        }
      }
    },
    {
      "id": "d03328eeeb3d1b1c75629a9c",
      "name": "Binary search trees",
      "nameHtml": "Binary search trees",
      "chapter": {
        "id": "f947d8971f85161093b98e60",
        "title": "Trees",
        "titleHtml": "Trees"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
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
      "id": "e226653a34850ddd0150b3b6",
      "name": "Big-O notation",
      "nameHtml": "Big-O notation",
      "chapter": {
        "id": "026aac1bbe9ae5ded520b83c",
        "title": "Complexity",
        "titleHtml": "Complexity"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
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
      "id": "0457ec366b25602c01538969",
      "name": "Counting steps",
      "nameHtml": "Counting steps",
      "chapter": {
        "id": "026aac1bbe9ae5ded520b83c",
        "title": "Complexity",
        "titleHtml": "Complexity"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
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

/** GET /hub/progress as asha just after a restart: every state but Needs review. */
export const PROGRESS_FRESH_REPLY = {
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
    "in-progress": 4,
    "mastered": 1,
    "needs-review": 0
  },
  "topics": [
    {
      "id": "4fbc6927fd78b9971585fa30",
      "name": "Functions",
      "nameHtml": "Functions",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
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
          "dueAt": "2026-11-27T14:37:39.931Z",
          "due": false,
          "when": "on 2026-11-27",
          "sessions": 1,
          "lastRating": "easy"
        }
      }
    },
    {
      "id": "2cf5b50b3434c269001b79d1",
      "name": "The call stack",
      "nameHtml": "The call stack",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
      ],
      "practiceQuestions": 6,
      "state": {
        "state": "in-progress",
        "label": "In progress",
        "answers": 5,
        "attempts": 5,
        "provisional": false,
        "pRight": 0.76,
        "outOf10": 7,
        "estimateState": "in-progress",
        "sentence": "In progress: from your 5 answers, you would likely get about 7 in 10 typical questions on this topic right. Mastered means about 8 in 10, from at least 5 answers.",
        "review": {
          "dueAt": "2026-11-19T14:43:09.965Z",
          "due": false,
          "when": "in 6 minutes",
          "sessions": 1,
          "lastRating": "hard"
        }
      }
    },
    {
      "id": "fb9b037ef299ed01dc747566",
      "name": "Base case",
      "nameHtml": "Base case",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
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
          "dueAt": "2026-11-19T14:47:39.736Z",
          "due": false,
          "when": "in 10 minutes",
          "sessions": 1,
          "lastRating": "good"
        }
      }
    },
    {
      "id": "4520c15ae70f4821ea9fc739",
      "name": "Recursion",
      "nameHtml": "Recursion",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
      ],
      "practiceQuestions": 6,
      "state": {
        "state": "in-progress",
        "label": "In progress",
        "answers": 4,
        "attempts": 4,
        "provisional": false,
        "pRight": 0.39,
        "outOf10": 3,
        "estimateState": "in-progress",
        "sentence": "In progress: from your 4 answers, you would likely get about 3 in 10 typical questions on this topic right. Mastered means about 8 in 10, from at least 5 answers.",
        "review": {
          "dueAt": "2026-11-19T14:38:40.136Z",
          "due": false,
          "when": "in 1 minute",
          "sessions": 1,
          "lastRating": "again"
        }
      }
    },
    {
      "id": "8a579f471e60eedf4ea6a156",
      "name": "Recursion trees",
      "nameHtml": "Recursion trees",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
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
      "id": "80bb36aea49afcc256c6f466",
      "name": "Memoisation",
      "nameHtml": "Memoisation",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
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
      "id": "3631acc31867b8e42aa8b992",
      "name": "Binary trees",
      "nameHtml": "Binary trees",
      "chapter": {
        "id": "f947d8971f85161093b98e60",
        "title": "Trees",
        "titleHtml": "Trees"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
      ],
      "practiceQuestions": 6,
      "state": {
        "state": "in-progress",
        "label": "In progress",
        "answers": 4,
        "attempts": 4,
        "provisional": false,
        "pRight": 0.82,
        "outOf10": 8,
        "estimateState": "in-progress",
        "sentence": "In progress: from your 4 answers, you would likely get about 8 in 10 typical questions on this topic right. Mastered needs at least 5 answers, so a few more will show it.",
        "review": {
          "dueAt": "2026-11-19T14:47:40.449Z",
          "due": false,
          "when": "in 10 minutes",
          "sessions": 1,
          "lastRating": "good"
        }
      }
    },
    {
      "id": "91141b57a9dd84a21dcfff47",
      "name": "Traversals",
      "nameHtml": "Traversals",
      "chapter": {
        "id": "f947d8971f85161093b98e60",
        "title": "Trees",
        "titleHtml": "Trees"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
      ],
      "practiceQuestions": 5,
      "state": {
        "state": "in-progress",
        "label": "In progress",
        "answers": 3,
        "attempts": 3,
        "provisional": false,
        "pRight": 0.73,
        "outOf10": 7,
        "estimateState": "in-progress",
        "sentence": "In progress: from your 3 answers, you would likely get about 7 in 10 typical questions on this topic right. Mastered means about 8 in 10, from at least 5 answers.",
        "review": {
          "dueAt": "2026-11-19T14:43:10.353Z",
          "due": false,
          "when": "in 6 minutes",
          "sessions": 1,
          "lastRating": "hard"
        }
      }
    },
    {
      "id": "d03328eeeb3d1b1c75629a9c",
      "name": "Binary search trees",
      "nameHtml": "Binary search trees",
      "chapter": {
        "id": "f947d8971f85161093b98e60",
        "title": "Trees",
        "titleHtml": "Trees"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
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
      "id": "e226653a34850ddd0150b3b6",
      "name": "Big-O notation",
      "nameHtml": "Big-O notation",
      "chapter": {
        "id": "026aac1bbe9ae5ded520b83c",
        "title": "Complexity",
        "titleHtml": "Complexity"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
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
      "id": "0457ec366b25602c01538969",
      "name": "Counting steps",
      "nameHtml": "Counting steps",
      "chapter": {
        "id": "026aac1bbe9ae5ded520b83c",
        "title": "Complexity",
        "titleHtml": "Complexity"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
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

/** GET /hub/progress as cara: on the class, nothing practised. */
export const PROGRESS_NONE_REPLY = {
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
    "not-started": 11,
    "not-sure": 0,
    "in-progress": 0,
    "mastered": 0,
    "needs-review": 0
  },
  "topics": [
    {
      "id": "4fbc6927fd78b9971585fa30",
      "name": "Functions",
      "nameHtml": "Functions",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
      ],
      "practiceQuestions": 8,
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
      "id": "2cf5b50b3434c269001b79d1",
      "name": "The call stack",
      "nameHtml": "The call stack",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
      ],
      "practiceQuestions": 6,
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
      "id": "fb9b037ef299ed01dc747566",
      "name": "Base case",
      "nameHtml": "Base case",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
      ],
      "practiceQuestions": 6,
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
      "id": "4520c15ae70f4821ea9fc739",
      "name": "Recursion",
      "nameHtml": "Recursion",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
      ],
      "practiceQuestions": 6,
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
      "id": "8a579f471e60eedf4ea6a156",
      "name": "Recursion trees",
      "nameHtml": "Recursion trees",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
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
      "id": "80bb36aea49afcc256c6f466",
      "name": "Memoisation",
      "nameHtml": "Memoisation",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
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
      "id": "3631acc31867b8e42aa8b992",
      "name": "Binary trees",
      "nameHtml": "Binary trees",
      "chapter": {
        "id": "f947d8971f85161093b98e60",
        "title": "Trees",
        "titleHtml": "Trees"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
      ],
      "practiceQuestions": 6,
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
      "id": "91141b57a9dd84a21dcfff47",
      "name": "Traversals",
      "nameHtml": "Traversals",
      "chapter": {
        "id": "f947d8971f85161093b98e60",
        "title": "Trees",
        "titleHtml": "Trees"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
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
      "id": "d03328eeeb3d1b1c75629a9c",
      "name": "Binary search trees",
      "nameHtml": "Binary search trees",
      "chapter": {
        "id": "f947d8971f85161093b98e60",
        "title": "Trees",
        "titleHtml": "Trees"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
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
      "id": "e226653a34850ddd0150b3b6",
      "name": "Big-O notation",
      "nameHtml": "Big-O notation",
      "chapter": {
        "id": "026aac1bbe9ae5ded520b83c",
        "title": "Complexity",
        "titleHtml": "Complexity"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
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
      "id": "0457ec366b25602c01538969",
      "name": "Counting steps",
      "nameHtml": "Counting steps",
      "chapter": {
        "id": "026aac1bbe9ae5ded520b83c",
        "title": "Complexity",
        "titleHtml": "Complexity"
      },
      "classIds": [
        "fbdd64a4562261ddd302a9a1"
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

/** GET /hub/topics/:id as asha, Recursion trees: a chain four deep, two at depth 2, Loops from earlier material. */
export const TOPIC_REPLY = {
  "topic": {
    "id": "8a579f471e60eedf4ea6a156",
    "name": "Recursion trees",
    "nameHtml": "Recursion trees",
    "chapter": {
      "id": "c9bc3c27219a562cdb8403b7",
      "title": "Recursion and the call stack",
      "titleHtml": "Recursion and the call stack"
    }
  },
  "prerequisites": [
    {
      "id": "4520c15ae70f4821ea9fc739",
      "name": "Recursion",
      "nameHtml": "Recursion",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 1,
      "via": [
        "8a579f471e60eedf4ea6a156"
      ],
      "onYourClasses": true
    },
    {
      "id": "2cf5b50b3434c269001b79d1",
      "name": "The call stack",
      "nameHtml": "The call stack",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 2,
      "via": [
        "4520c15ae70f4821ea9fc739"
      ],
      "onYourClasses": true
    },
    {
      "id": "fb9b037ef299ed01dc747566",
      "name": "Base case",
      "nameHtml": "Base case",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 2,
      "via": [
        "4520c15ae70f4821ea9fc739"
      ],
      "onYourClasses": true
    },
    {
      "id": "4fbc6927fd78b9971585fa30",
      "name": "Functions",
      "nameHtml": "Functions",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 3,
      "via": [
        "2cf5b50b3434c269001b79d1"
      ],
      "onYourClasses": true
    },
    {
      "id": "16e92289f5d3ee0f42285445",
      "name": "Loops",
      "nameHtml": "Loops",
      "chapter": {
        "id": "a46cfceb15a46ae8197e52e3",
        "title": "Programming basics (last semester)",
        "titleHtml": "Programming basics (last semester)"
      },
      "depth": 4,
      "via": [
        "4fbc6927fd78b9971585fa30"
      ],
      "onYourClasses": false
    }
  ],
  "leadsTo": [
    {
      "id": "80bb36aea49afcc256c6f466",
      "name": "Memoisation",
      "nameHtml": "Memoisation",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 1,
      "via": [
        "8a579f471e60eedf4ea6a156"
      ],
      "onYourClasses": true
    }
  ],
  "note": "Prerequisites are the topics your professor confirmed are needed first, nearest first."
};

/** GET /hub/topics/:id as asha, Memoisation: the longest chain. */
export const TOPIC_LONG_REPLY = {
  "topic": {
    "id": "80bb36aea49afcc256c6f466",
    "name": "Memoisation",
    "nameHtml": "Memoisation",
    "chapter": {
      "id": "c9bc3c27219a562cdb8403b7",
      "title": "Recursion and the call stack",
      "titleHtml": "Recursion and the call stack"
    }
  },
  "prerequisites": [
    {
      "id": "8a579f471e60eedf4ea6a156",
      "name": "Recursion trees",
      "nameHtml": "Recursion trees",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 1,
      "via": [
        "80bb36aea49afcc256c6f466"
      ],
      "onYourClasses": true
    },
    {
      "id": "4520c15ae70f4821ea9fc739",
      "name": "Recursion",
      "nameHtml": "Recursion",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 2,
      "via": [
        "8a579f471e60eedf4ea6a156"
      ],
      "onYourClasses": true
    },
    {
      "id": "2cf5b50b3434c269001b79d1",
      "name": "The call stack",
      "nameHtml": "The call stack",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 3,
      "via": [
        "4520c15ae70f4821ea9fc739"
      ],
      "onYourClasses": true
    },
    {
      "id": "fb9b037ef299ed01dc747566",
      "name": "Base case",
      "nameHtml": "Base case",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 3,
      "via": [
        "4520c15ae70f4821ea9fc739"
      ],
      "onYourClasses": true
    },
    {
      "id": "4fbc6927fd78b9971585fa30",
      "name": "Functions",
      "nameHtml": "Functions",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 4,
      "via": [
        "2cf5b50b3434c269001b79d1"
      ],
      "onYourClasses": true
    },
    {
      "id": "16e92289f5d3ee0f42285445",
      "name": "Loops",
      "nameHtml": "Loops",
      "chapter": {
        "id": "a46cfceb15a46ae8197e52e3",
        "title": "Programming basics (last semester)",
        "titleHtml": "Programming basics (last semester)"
      },
      "depth": 5,
      "via": [
        "4fbc6927fd78b9971585fa30"
      ],
      "onYourClasses": false
    }
  ],
  "leadsTo": [],
  "note": "Prerequisites are the topics your professor confirmed are needed first, nearest first."
};

/** GET /hub/topics/:id as asha, Traversals: two direct prerequisites from two units. */
export const TOPIC_TRAVERSALS_REPLY = {
  "topic": {
    "id": "91141b57a9dd84a21dcfff47",
    "name": "Traversals",
    "nameHtml": "Traversals",
    "chapter": {
      "id": "f947d8971f85161093b98e60",
      "title": "Trees",
      "titleHtml": "Trees"
    }
  },
  "prerequisites": [
    {
      "id": "4520c15ae70f4821ea9fc739",
      "name": "Recursion",
      "nameHtml": "Recursion",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 1,
      "via": [
        "91141b57a9dd84a21dcfff47"
      ],
      "onYourClasses": true
    },
    {
      "id": "3631acc31867b8e42aa8b992",
      "name": "Binary trees",
      "nameHtml": "Binary trees",
      "chapter": {
        "id": "f947d8971f85161093b98e60",
        "title": "Trees",
        "titleHtml": "Trees"
      },
      "depth": 1,
      "via": [
        "91141b57a9dd84a21dcfff47"
      ],
      "onYourClasses": true
    },
    {
      "id": "2cf5b50b3434c269001b79d1",
      "name": "The call stack",
      "nameHtml": "The call stack",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 2,
      "via": [
        "4520c15ae70f4821ea9fc739"
      ],
      "onYourClasses": true
    },
    {
      "id": "fb9b037ef299ed01dc747566",
      "name": "Base case",
      "nameHtml": "Base case",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 2,
      "via": [
        "4520c15ae70f4821ea9fc739"
      ],
      "onYourClasses": true
    },
    {
      "id": "4fbc6927fd78b9971585fa30",
      "name": "Functions",
      "nameHtml": "Functions",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 3,
      "via": [
        "2cf5b50b3434c269001b79d1"
      ],
      "onYourClasses": true
    },
    {
      "id": "16e92289f5d3ee0f42285445",
      "name": "Loops",
      "nameHtml": "Loops",
      "chapter": {
        "id": "a46cfceb15a46ae8197e52e3",
        "title": "Programming basics (last semester)",
        "titleHtml": "Programming basics (last semester)"
      },
      "depth": 4,
      "via": [
        "4fbc6927fd78b9971585fa30"
      ],
      "onYourClasses": false
    }
  ],
  "leadsTo": [],
  "note": "Prerequisites are the topics your professor confirmed are needed first, nearest first."
};

/** GET /hub/topics/:id as asha, Functions: one prerequisite, from earlier material (onYourClasses false). */
export const TOPIC_EARLIER_REPLY = {
  "topic": {
    "id": "4fbc6927fd78b9971585fa30",
    "name": "Functions",
    "nameHtml": "Functions",
    "chapter": {
      "id": "c9bc3c27219a562cdb8403b7",
      "title": "Recursion and the call stack",
      "titleHtml": "Recursion and the call stack"
    }
  },
  "prerequisites": [
    {
      "id": "16e92289f5d3ee0f42285445",
      "name": "Loops",
      "nameHtml": "Loops",
      "chapter": {
        "id": "a46cfceb15a46ae8197e52e3",
        "title": "Programming basics (last semester)",
        "titleHtml": "Programming basics (last semester)"
      },
      "depth": 1,
      "via": [
        "4fbc6927fd78b9971585fa30"
      ],
      "onYourClasses": false
    }
  ],
  "leadsTo": [
    {
      "id": "2cf5b50b3434c269001b79d1",
      "name": "The call stack",
      "nameHtml": "The call stack",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 1,
      "via": [
        "4fbc6927fd78b9971585fa30"
      ],
      "onYourClasses": true
    },
    {
      "id": "4520c15ae70f4821ea9fc739",
      "name": "Recursion",
      "nameHtml": "Recursion",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 2,
      "via": [
        "2cf5b50b3434c269001b79d1"
      ],
      "onYourClasses": true
    },
    {
      "id": "8a579f471e60eedf4ea6a156",
      "name": "Recursion trees",
      "nameHtml": "Recursion trees",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 3,
      "via": [
        "4520c15ae70f4821ea9fc739"
      ],
      "onYourClasses": true
    },
    {
      "id": "91141b57a9dd84a21dcfff47",
      "name": "Traversals",
      "nameHtml": "Traversals",
      "chapter": {
        "id": "f947d8971f85161093b98e60",
        "title": "Trees",
        "titleHtml": "Trees"
      },
      "depth": 3,
      "via": [
        "4520c15ae70f4821ea9fc739"
      ],
      "onYourClasses": true
    },
    {
      "id": "80bb36aea49afcc256c6f466",
      "name": "Memoisation",
      "nameHtml": "Memoisation",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 4,
      "via": [
        "8a579f471e60eedf4ea6a156"
      ],
      "onYourClasses": true
    }
  ],
  "note": "Prerequisites are the topics your professor confirmed are needed first, nearest first."
};

/** GET /hub/topics/:id as asha, Binary trees: nothing comes first. */
export const TOPIC_NONE_REPLY = {
  "topic": {
    "id": "3631acc31867b8e42aa8b992",
    "name": "Binary trees",
    "nameHtml": "Binary trees",
    "chapter": {
      "id": "f947d8971f85161093b98e60",
      "title": "Trees",
      "titleHtml": "Trees"
    }
  },
  "prerequisites": [],
  "leadsTo": [
    {
      "id": "91141b57a9dd84a21dcfff47",
      "name": "Traversals",
      "nameHtml": "Traversals",
      "chapter": {
        "id": "f947d8971f85161093b98e60",
        "title": "Trees",
        "titleHtml": "Trees"
      },
      "depth": 1,
      "via": [
        "3631acc31867b8e42aa8b992"
      ],
      "onYourClasses": true
    },
    {
      "id": "d03328eeeb3d1b1c75629a9c",
      "name": "Binary search trees",
      "nameHtml": "Binary search trees",
      "chapter": {
        "id": "f947d8971f85161093b98e60",
        "title": "Trees",
        "titleHtml": "Trees"
      },
      "depth": 1,
      "via": [
        "3631acc31867b8e42aa8b992"
      ],
      "onYourClasses": true
    }
  ],
  "note": "Prerequisites are the topics your professor confirmed are needed first, nearest first."
};

/** GET /hub/review/due as asha some minutes after a restart: due now and coming up. */
export const REVIEW_REPLY = {
  "due": [
    {
      "id": "4520c15ae70f4821ea9fc739",
      "name": "Recursion",
      "nameHtml": "Recursion",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "state": "needs-review",
      "label": "Needs review",
      "answers": 4,
      "review": {
        "dueAt": "2026-11-19T14:38:40.136Z",
        "due": true,
        "when": "now",
        "sessions": 1,
        "lastRating": "again"
      },
      "practiceQuestions": 6
    },
    {
      "id": "2cf5b50b3434c269001b79d1",
      "name": "The call stack",
      "nameHtml": "The call stack",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "state": "needs-review",
      "label": "Needs review",
      "answers": 5,
      "review": {
        "dueAt": "2026-11-19T14:43:09.965Z",
        "due": true,
        "when": "now",
        "sessions": 1,
        "lastRating": "hard"
      },
      "practiceQuestions": 6
    },
    {
      "id": "91141b57a9dd84a21dcfff47",
      "name": "Traversals",
      "nameHtml": "Traversals",
      "chapter": {
        "id": "f947d8971f85161093b98e60",
        "title": "Trees",
        "titleHtml": "Trees"
      },
      "state": "needs-review",
      "label": "Needs review",
      "answers": 3,
      "review": {
        "dueAt": "2026-11-19T14:43:10.353Z",
        "due": true,
        "when": "now",
        "sessions": 1,
        "lastRating": "hard"
      },
      "practiceQuestions": 5
    }
  ],
  "upcoming": [
    {
      "id": "fb9b037ef299ed01dc747566",
      "name": "Base case",
      "nameHtml": "Base case",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "state": "not-sure",
      "label": "Not sure yet",
      "answers": 2,
      "review": {
        "dueAt": "2026-11-19T14:47:39.736Z",
        "due": false,
        "when": "in 4 minutes",
        "sessions": 1,
        "lastRating": "good"
      },
      "practiceQuestions": 6
    },
    {
      "id": "3631acc31867b8e42aa8b992",
      "name": "Binary trees",
      "nameHtml": "Binary trees",
      "chapter": {
        "id": "f947d8971f85161093b98e60",
        "title": "Trees",
        "titleHtml": "Trees"
      },
      "state": "in-progress",
      "label": "In progress",
      "answers": 4,
      "review": {
        "dueAt": "2026-11-19T14:47:40.449Z",
        "due": false,
        "when": "in 4 minutes",
        "sessions": 1,
        "lastRating": "good"
      },
      "practiceQuestions": 6
    }
  ],
  "setSize": 5,
  "rule": "A review is a short practice set on the topic. Its result sets when the topic comes back: under 40% right brings it back soonest, 40% to under 70% soon, 70% or more later, and 90% or more from at least 5 answers with no hint latest."
};

/** GET /hub/review/due as asha just after a restart: nothing due yet, five coming up within minutes. */
export const REVIEW_SOON_REPLY = {
  "due": [],
  "upcoming": [
    {
      "id": "4520c15ae70f4821ea9fc739",
      "name": "Recursion",
      "nameHtml": "Recursion",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "state": "in-progress",
      "label": "In progress",
      "answers": 4,
      "review": {
        "dueAt": "2026-11-19T14:38:40.136Z",
        "due": false,
        "when": "in 1 minute",
        "sessions": 1,
        "lastRating": "again"
      },
      "practiceQuestions": 6
    },
    {
      "id": "2cf5b50b3434c269001b79d1",
      "name": "The call stack",
      "nameHtml": "The call stack",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "state": "in-progress",
      "label": "In progress",
      "answers": 5,
      "review": {
        "dueAt": "2026-11-19T14:43:09.965Z",
        "due": false,
        "when": "in 6 minutes",
        "sessions": 1,
        "lastRating": "hard"
      },
      "practiceQuestions": 6
    },
    {
      "id": "91141b57a9dd84a21dcfff47",
      "name": "Traversals",
      "nameHtml": "Traversals",
      "chapter": {
        "id": "f947d8971f85161093b98e60",
        "title": "Trees",
        "titleHtml": "Trees"
      },
      "state": "in-progress",
      "label": "In progress",
      "answers": 3,
      "review": {
        "dueAt": "2026-11-19T14:43:10.353Z",
        "due": false,
        "when": "in 6 minutes",
        "sessions": 1,
        "lastRating": "hard"
      },
      "practiceQuestions": 5
    },
    {
      "id": "fb9b037ef299ed01dc747566",
      "name": "Base case",
      "nameHtml": "Base case",
      "chapter": {
        "id": "c9bc3c27219a562cdb8403b7",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "state": "not-sure",
      "label": "Not sure yet",
      "answers": 2,
      "review": {
        "dueAt": "2026-11-19T14:47:39.736Z",
        "due": false,
        "when": "in 10 minutes",
        "sessions": 1,
        "lastRating": "good"
      },
      "practiceQuestions": 6
    },
    {
      "id": "3631acc31867b8e42aa8b992",
      "name": "Binary trees",
      "nameHtml": "Binary trees",
      "chapter": {
        "id": "f947d8971f85161093b98e60",
        "title": "Trees",
        "titleHtml": "Trees"
      },
      "state": "in-progress",
      "label": "In progress",
      "answers": 4,
      "review": {
        "dueAt": "2026-11-19T14:47:40.449Z",
        "due": false,
        "when": "in 10 minutes",
        "sessions": 1,
        "lastRating": "good"
      },
      "practiceQuestions": 6
    }
  ],
  "setSize": 5,
  "rule": "A review is a short practice set on the topic. Its result sets when the topic comes back: under 40% right brings it back soonest, 40% to under 70% soon, 70% or more later, and 90% or more from at least 5 answers with no hint latest.",
  "empty": "Nothing is due for review now."
};

/** GET /hub/review/due as cara: nothing due, nothing coming up. */
export const REVIEW_NONE_REPLY = {
  "due": [],
  "upcoming": [],
  "setSize": 5,
  "rule": "A review is a short practice set on the topic. Its result sets when the topic comes back: under 40% right brings it back soonest, 40% to under 70% soon, 70% or more later, and 90% or more from at least 5 answers with no hint latest.",
  "empty": "Nothing is due for review now."
};

/** GET /hub/errors as asha, every entry. */
export const ERRORS_REPLY = {
  "entries": [
    {
      "id": "practice:a826c10d5f43606c79916f7c",
      "status": "open",
      "from": "practice",
      "fromLabel": "From your practice",
      "topic": {
        "id": "91141b57a9dd84a21dcfff47",
        "name": "Traversals",
        "nameHtml": "Traversals",
        "chapter": {
          "id": "f947d8971f85161093b98e60",
          "title": "Trees",
          "titleHtml": "Trees"
        }
      },
      "level": "remember",
      "levelLabel": "Remember",
      "times": 1,
      "firstAt": "2026-11-19T14:37:40.353Z",
      "lastAt": "2026-11-19T14:37:40.353Z",
      "clearedAt": null,
      "clearedBy": null,
      "question": {
        "text": "Which traversal visits a node before both of its subtrees?",
        "bloom": "remember",
        "topic": "Traversals",
        "kind": "mcq",
        "source": "teacher",
        "options": [
          "Pre-order",
          "In-order",
          "Post-order",
          "None of them"
        ],
        "rich": {}
      },
      "response": 1,
      "solution": 0,
      "prerequisites": [
        {
          "id": "4520c15ae70f4821ea9fc739",
          "name": "Recursion",
          "nameHtml": "Recursion",
          "depth": 1
        },
        {
          "id": "3631acc31867b8e42aa8b992",
          "name": "Binary trees",
          "nameHtml": "Binary trees",
          "depth": 1
        },
        {
          "id": "2cf5b50b3434c269001b79d1",
          "name": "The call stack",
          "nameHtml": "The call stack",
          "depth": 2
        },
        {
          "id": "fb9b037ef299ed01dc747566",
          "name": "Base case",
          "nameHtml": "Base case",
          "depth": 2
        },
        {
          "id": "4fbc6927fd78b9971585fa30",
          "name": "Functions",
          "nameHtml": "Functions",
          "depth": 3
        },
        {
          "id": "16e92289f5d3ee0f42285445",
          "name": "Loops",
          "nameHtml": "Loops",
          "depth": 4
        }
      ],
      "sentence": "Answered wrong in practice. It clears when you get another question on this topic right at Remember or above.",
      "explanation": {
        "text": "Pre-order means the node comes first (\"pre\"), then its left and right subtrees.",
        "textHtml": "Pre-order means the node comes first (&quot;pre&quot;), then its left and right subtrees.",
        "by": "professor",
        "label": "Written by your professor.",
        "note": "Shown after you answer.",
        "language": {
          "requested": "en",
          "language": "en",
          "translationId": null,
          "note": null
        }
      }
    },
    {
      "id": "practice:b8596548b67cb73ce7ba3095",
      "status": "open",
      "from": "practice",
      "fromLabel": "From your practice",
      "topic": {
        "id": "3631acc31867b8e42aa8b992",
        "name": "Binary trees",
        "nameHtml": "Binary trees",
        "chapter": {
          "id": "f947d8971f85161093b98e60",
          "title": "Trees",
          "titleHtml": "Trees"
        }
      },
      "level": "apply",
      "levelLabel": "Apply",
      "times": 1,
      "firstAt": "2026-11-19T14:37:40.255Z",
      "lastAt": "2026-11-19T14:37:40.255Z",
      "clearedAt": null,
      "clearedBy": null,
      "question": {
        "text": "Using $2^{h+1} - 1$, at most how many nodes can a binary tree of height $h = 2$ have?",
        "bloom": "apply",
        "topic": "Binary trees",
        "kind": "numeric",
        "source": "teacher",
        "unit": "",
        "rich": {
          "text": "Using <math><mrow><msup><mn>2</mn><mrow><mi>h</mi><mo>+</mo><mn>1</mn></mrow></msup><mo>−</mo><mn>1</mn></mrow></math>, at most how many nodes can a binary tree of height <math><mrow><mi>h</mi><mo>=</mo><mn>2</mn></mrow></math> have?"
        }
      },
      "response": 14,
      "solution": 7,
      "prerequisites": [],
      "sentence": "Answered wrong in practice. It clears when you get another question on this topic right at Apply or above.",
      "explanation": {
        "text": "With $h = 2$: $2^{3} - 1 = 7$. A full tree of height 2 has 1 + 2 + 4 nodes.",
        "textHtml": "With <math><mrow><mi>h</mi><mo>=</mo><mn>2</mn></mrow></math>: <math><mrow><msup><mn>2</mn><mn>3</mn></msup><mo>−</mo><mn>1</mn><mo>=</mo><mn>7</mn></mrow></math>. A full tree of height 2 has 1 + 2 + 4 nodes.",
        "by": "professor",
        "label": "Written by your professor.",
        "note": "Shown after you answer.",
        "language": {
          "requested": "en",
          "language": "en",
          "translationId": null,
          "note": null
        }
      }
    },
    {
      "id": "practice:bec5b9f4baf7ca15158fcbc2",
      "status": "cleared",
      "from": "practice",
      "fromLabel": "From your practice",
      "topic": {
        "id": "4520c15ae70f4821ea9fc739",
        "name": "Recursion",
        "nameHtml": "Recursion",
        "chapter": {
          "id": "c9bc3c27219a562cdb8403b7",
          "title": "Recursion and the call stack",
          "titleHtml": "Recursion and the call stack"
        }
      },
      "level": "remember",
      "levelLabel": "Remember",
      "times": 1,
      "firstAt": "2026-11-19T14:37:40.072Z",
      "lastAt": "2026-11-19T14:37:40.072Z",
      "clearedAt": "2026-11-19T14:37:40.136Z",
      "clearedBy": {
        "from": "practice",
        "bloom": "remember",
        "at": "2026-11-19T14:37:40.136Z",
        "provisional": false
      },
      "question": {
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
        "rich": {}
      },
      "response": 1,
      "solution": 0,
      "prerequisites": [
        {
          "id": "2cf5b50b3434c269001b79d1",
          "name": "The call stack",
          "nameHtml": "The call stack",
          "depth": 1
        },
        {
          "id": "fb9b037ef299ed01dc747566",
          "name": "Base case",
          "nameHtml": "Base case",
          "depth": 1
        },
        {
          "id": "4fbc6927fd78b9971585fa30",
          "name": "Functions",
          "nameHtml": "Functions",
          "depth": 2
        },
        {
          "id": "16e92289f5d3ee0f42285445",
          "name": "Loops",
          "nameHtml": "Loops",
          "depth": 3
        }
      ],
      "sentence": "Answered wrong in practice; cleared when you got another Remember question on this topic right in practice.",
      "explanation": {
        "text": "Each call adds its `n` to the call below it: $3 + 2 + 1 + 0 = 6$.\n```python\nf(3) = 3 + f(2) = 3 + 2 + f(1) = 3 + 2 + 1 + f(0) = 6\n```",
        "textHtml": "Each call adds its `n` to the call below it: <math><mrow><mn>3</mn><mo>+</mo><mn>2</mn><mo>+</mo><mn>1</mn><mo>+</mo><mn>0</mn><mo>=</mo><mn>6</mn></mrow></math>.<pre class=\"shiki shiki-themes github-light github-dark\" style=\"background-color:#fff;--shiki-dark-bg:#24292e;color:#24292e;--shiki-dark:#e1e4e8\" tabindex=\"0\"><code><span class=\"line\"><span style=\"color:#24292E;--shiki-dark:#E1E4E8\">f(</span><span style=\"color:#005CC5;--shiki-dark:#79B8FF\">3</span><span style=\"color:#24292E;--shiki-dark:#E1E4E8\">) </span><span style=\"color:#D73A49;--shiki-dark:#F97583\">=</span><span style=\"color:#005CC5;--shiki-dark:#79B8FF\"> 3</span><span style=\"color:#D73A49;--shiki-dark:#F97583\"> +</span><span style=\"color:#24292E;--shiki-dark:#E1E4E8\"> f(</span><span style=\"color:#005CC5;--shiki-dark:#79B8FF\">2</span><span style=\"color:#24292E;--shiki-dark:#E1E4E8\">) </span><span style=\"color:#D73A49;--shiki-dark:#F97583\">=</span><span style=\"color:#005CC5;--shiki-dark:#79B8FF\"> 3</span><span style=\"color:#D73A49;--shiki-dark:#F97583\"> +</span><span style=\"color:#005CC5;--shiki-dark:#79B8FF\"> 2</span><span style=\"color:#D73A49;--shiki-dark:#F97583\"> +</span><span style=\"color:#24292E;--shiki-dark:#E1E4E8\"> f(</span><span style=\"color:#005CC5;--shiki-dark:#79B8FF\">1</span><span style=\"color:#24292E;--shiki-dark:#E1E4E8\">) </span><span style=\"color:#D73A49;--shiki-dark:#F97583\">=</span><span style=\"color:#005CC5;--shiki-dark:#79B8FF\"> 3</span><span style=\"color:#D73A49;--shiki-dark:#F97583\"> +</span><span style=\"color:#005CC5;--shiki-dark:#79B8FF\"> 2</span><span style=\"color:#D73A49;--shiki-dark:#F97583\"> +</span><span style=\"color:#005CC5;--shiki-dark:#79B8FF\"> 1</span><span style=\"color:#D73A49;--shiki-dark:#F97583\"> +</span><span style=\"color:#24292E;--shiki-dark:#E1E4E8\"> f(</span><span style=\"color:#005CC5;--shiki-dark:#79B8FF\">0</span><span style=\"color:#24292E;--shiki-dark:#E1E4E8\">) </span><span style=\"color:#D73A49;--shiki-dark:#F97583\">=</span><span style=\"color:#005CC5;--shiki-dark:#79B8FF\"> 6</span></span></code></pre>",
        "by": "professor",
        "label": "Written by your professor.",
        "note": "Shown after you answer.",
        "language": {
          "requested": "en",
          "language": "en",
          "translationId": null,
          "note": null
        }
      }
    },
    {
      "id": "practice:f9d0cc3f2cdc2801b8bd9512",
      "status": "open",
      "from": "practice",
      "fromLabel": "From your practice",
      "topic": {
        "id": "2cf5b50b3434c269001b79d1",
        "name": "The call stack",
        "nameHtml": "The call stack",
        "chapter": {
          "id": "c9bc3c27219a562cdb8403b7",
          "title": "Recursion and the call stack",
          "titleHtml": "Recursion and the call stack"
        }
      },
      "level": "apply",
      "levelLabel": "Apply",
      "times": 1,
      "firstAt": "2026-11-19T14:37:39.965Z",
      "lastAt": "2026-11-19T14:37:39.965Z",
      "clearedAt": null,
      "clearedBy": null,
      "question": {
        "text": "How many frames are on the stack while `c` runs, counting `main`? ```python def c(): pass def b(): c() def a(): b() def main(): a() ```",
        "bloom": "apply",
        "topic": "The call stack",
        "kind": "numeric",
        "source": "teacher",
        "unit": "",
        "rich": {}
      },
      "response": 11,
      "solution": 4,
      "prerequisites": [
        {
          "id": "4fbc6927fd78b9971585fa30",
          "name": "Functions",
          "nameHtml": "Functions",
          "depth": 1
        },
        {
          "id": "16e92289f5d3ee0f42285445",
          "name": "Loops",
          "nameHtml": "Loops",
          "depth": 2
        }
      ],
      "sentence": "Answered wrong in practice. It clears when you get another question on this topic right at Apply or above.",
      "explanation": {
        "text": "main calls a, a calls b, and b calls c, so four frames are on the stack while c runs.",
        "textHtml": "main calls a, a calls b, and b calls c, so four frames are on the stack while c runs.",
        "by": "ai",
        "label": "Written with AI help and checked by your professor.",
        "note": "Shown after you answer.",
        "language": {
          "requested": "en",
          "language": "en",
          "translationId": null,
          "note": null
        }
      }
    },
    {
      "id": "practice:b3dff27c8b933b028ef17dc7",
      "status": "open",
      "from": "practice",
      "fromLabel": "From your practice",
      "topic": {
        "id": "2cf5b50b3434c269001b79d1",
        "name": "The call stack",
        "nameHtml": "The call stack",
        "chapter": {
          "id": "c9bc3c27219a562cdb8403b7",
          "title": "Recursion and the call stack",
          "titleHtml": "Recursion and the call stack"
        }
      },
      "level": "analyse",
      "levelLabel": "Analyse",
      "times": 1,
      "firstAt": "2026-11-19T14:37:39.659Z",
      "lastAt": "2026-11-19T14:37:39.659Z",
      "clearedAt": null,
      "clearedBy": null,
      "question": {
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
        "rich": {}
      },
      "response": [
        3
      ],
      "solution": [
        0,
        1,
        2
      ],
      "prerequisites": [
        {
          "id": "4fbc6927fd78b9971585fa30",
          "name": "Functions",
          "nameHtml": "Functions",
          "depth": 1
        },
        {
          "id": "16e92289f5d3ee0f42285445",
          "name": "Loops",
          "nameHtml": "Loops",
          "depth": 2
        }
      ],
      "sentence": "Answered wrong in practice. It clears when you get another question on this topic right at Analyse or above.",
      "explanation": null
    },
    {
      "id": "practice:bf28759d14c101840fc01d05",
      "status": "cleared",
      "from": "practice",
      "fromLabel": "From your practice",
      "topic": {
        "id": "4520c15ae70f4821ea9fc739",
        "name": "Recursion",
        "nameHtml": "Recursion",
        "chapter": {
          "id": "c9bc3c27219a562cdb8403b7",
          "title": "Recursion and the call stack",
          "titleHtml": "Recursion and the call stack"
        }
      },
      "level": "remember",
      "levelLabel": "Remember",
      "times": 1,
      "firstAt": "2026-11-19T14:37:39.591Z",
      "lastAt": "2026-11-19T14:37:39.591Z",
      "clearedAt": "2026-11-19T14:37:40.136Z",
      "clearedBy": {
        "from": "practice",
        "bloom": "remember",
        "at": "2026-11-19T14:37:40.136Z",
        "provisional": false
      },
      "question": {
        "text": "Every recursive function can also be written with a loop and a stack.",
        "bloom": "remember",
        "topic": "Recursion",
        "kind": "truefalse",
        "source": "teacher",
        "rich": {}
      },
      "response": false,
      "solution": true,
      "prerequisites": [
        {
          "id": "2cf5b50b3434c269001b79d1",
          "name": "The call stack",
          "nameHtml": "The call stack",
          "depth": 1
        },
        {
          "id": "fb9b037ef299ed01dc747566",
          "name": "Base case",
          "nameHtml": "Base case",
          "depth": 1
        },
        {
          "id": "4fbc6927fd78b9971585fa30",
          "name": "Functions",
          "nameHtml": "Functions",
          "depth": 2
        },
        {
          "id": "16e92289f5d3ee0f42285445",
          "name": "Loops",
          "nameHtml": "Loops",
          "depth": 3
        }
      ],
      "sentence": "Answered wrong in practice; cleared when you got another Remember question on this topic right in practice.",
      "explanation": null
    },
    {
      "id": "practice:09a9bb8ef6ae2b81e86abe42",
      "status": "open",
      "from": "practice",
      "fromLabel": "From your practice",
      "topic": {
        "id": "4520c15ae70f4821ea9fc739",
        "name": "Recursion",
        "nameHtml": "Recursion",
        "chapter": {
          "id": "c9bc3c27219a562cdb8403b7",
          "title": "Recursion and the call stack",
          "titleHtml": "Recursion and the call stack"
        }
      },
      "level": "apply",
      "levelLabel": "Apply",
      "times": 1,
      "firstAt": "2026-11-19T14:37:39.487Z",
      "lastAt": "2026-11-19T14:37:39.487Z",
      "clearedAt": null,
      "clearedBy": null,
      "question": {
        "text": "The recursive case of $n!$ calls the factorial on $n$ minus ____.",
        "bloom": "apply",
        "topic": "Recursion",
        "kind": "blank",
        "source": "teacher",
        "blankCount": 1,
        "rich": {
          "text": "The recursive case of <math><mrow><mi>n</mi><mo form=\"postfix\" stretchy=\"false\">!</mo></mrow></math> calls the factorial on <math><mi>n</mi></math> minus ____."
        }
      },
      "response": "not sure",
      "solution": "1",
      "prerequisites": [
        {
          "id": "2cf5b50b3434c269001b79d1",
          "name": "The call stack",
          "nameHtml": "The call stack",
          "depth": 1
        },
        {
          "id": "fb9b037ef299ed01dc747566",
          "name": "Base case",
          "nameHtml": "Base case",
          "depth": 1
        },
        {
          "id": "4fbc6927fd78b9971585fa30",
          "name": "Functions",
          "nameHtml": "Functions",
          "depth": 2
        },
        {
          "id": "16e92289f5d3ee0f42285445",
          "name": "Loops",
          "nameHtml": "Loops",
          "depth": 3
        }
      ],
      "sentence": "Answered wrong in practice. It clears when you get another question on this topic right at Apply or above.",
      "explanation": null
    }
  ],
  "counts": {
    "open": 5,
    "cleared": 2
  },
  "openByTopic": {
    "4520c15ae70f4821ea9fc739": 1,
    "2cf5b50b3434c269001b79d1": 2,
    "3631acc31867b8e42aa8b992": 1,
    "91141b57a9dd84a21dcfff47": 1
  },
  "rule": "An entry clears when a different question on the same topic, at its level or above, is answered right."
};

/** GET /hub/errors as cara: an empty log. */
export const ERRORS_EMPTY_REPLY = {
  "entries": [],
  "counts": {
    "open": 0,
    "cleared": 0
  },
  "openByTopic": {},
  "rule": "An entry clears when a different question on the same topic, at its level or above, is answered right."
};

/* ------------------------------------------------- built from docs/API.md */

/** As lib/api.js throws them: the server's sentence, its status and the body. */
const refused = (status, error) => Object.assign(new Error(error), { status, body: { error } });

/** Every hub route on a server with no accounts (the memory server on :5050, read with curl on 19 Nov). */
export const NO_ACCOUNTS = refused(503, 'The learning hub needs student and staff accounts, and this server has none set up.');
/** Captured: hub.home() with nobody signed in. */
export const SIGNED_OUT = refused(401, 'Sign in to continue.');
/** Captured: hub.home() as profA. */
export const STAFF_HERE = refused(403, 'This is for a student account. Staff see their students\' progress through the class.');
/** Captured: hub.klass() as omar, profB's student. */
export const NO_CLASS = refused(404, 'That class was not found.');

/** A class with nothing placed: the server's `empty`. */
export const CLASS_EMPTY_REPLY = {
  class: { ...CLASS_REPLY.class, id: '5b0c00000000000000000002', courseName: 'Operating Systems', section: 'TE B' },
  units: [],
  otherChapters: { label: 'Other chapters', chapters: [] },
  empty: 'Your professor has not added any chapters to this class yet.',
  notice: CLASS_REPLY.notice,
};

const byName = (name) => PROGRESS_REPLY.topics.find((t) => t.name === name);

const topicRef = (name) => { const t = byName(name); return { id: t.id, name: t.name, nameHtml: t.nameHtml, chapter: t.chapter }; };

/**
 * asha's log with two more entries the harness does not make: a "From class"
 * answer whose key a room holds back (`keyHeld`, solution and explanation
 * null), and an order question, read in words.
 */
export const ERRORS_MIXED_REPLY = {
  ...ERRORS_REPLY,
  entries: [
    {
      id: 'class:5b0c00000000000000000901', status: 'open', from: 'class', fromLabel: 'From class', topic: topicRef('Binary trees'),
      level: 'analyse', levelLabel: 'Analyse', times: 2, firstAt: '2026-11-18T05:10:00.000Z', lastAt: '2026-11-19T05:12:00.000Z',
      clearedAt: null, clearedBy: null,
      question: {
        text: 'Which of these hold for every binary tree with $n$ nodes?', bloom: 'analyse', topic: 'Binary trees', kind: 'multi', source: 'teacher',
        options: ['It has $n - 1$ edges', 'Its height is at most $\log_2 n$', 'Each node has at most two children', 'It is balanced'],
        rich: {
          text: 'Which of these hold for every binary tree with <math><mi>n</mi></math> nodes?',
          options: [
            'It has <math><mrow><mi>n</mi><mo>−</mo><mn>1</mn></mrow></math> edges',
            'Its height is at most <math><mrow><msub><mi>log</mi><mn>2</mn></msub><mo>⁡</mo><mi>n</mi></mrow></math>',
            'Each node has at most two children',
            'It is balanced',
          ],
        },
      },
      response: [1, 2], solution: null, explanation: null,
      prerequisites: [],
      keyHeld: 'This question is being asked in class right now, so what was right, and why, is shown here once the class has moved on.',
      sentence: 'Answered wrong in class (2 times). It clears when you get another question on this topic right at Analyse or above.',
    },
    {
      id: 'practice:5b0c00000000000000000902', status: 'open', from: 'practice', fromLabel: 'From your practice', topic: topicRef('Recursion trees'),
      level: 'evaluate', levelLabel: 'Evaluate', times: 1, firstAt: '2026-11-19T09:20:00.000Z', lastAt: '2026-11-19T09:20:00.000Z',
      clearedAt: null, clearedBy: null,
      question: {
        text: 'Put the calls of fib(3) in the order they start.', bloom: 'evaluate', topic: 'Recursion trees', kind: 'order', source: 'teacher',
        items: ['fib(1)', 'fib(3)', 'fib(2)'], rich: {},
      },
      response: [0, 1, 2], solution: ['fib(3)', 'fib(2)', 'fib(1)'], explanation: null,
      prerequisites: [{ id: byName('Recursion').id, name: 'Recursion', nameHtml: 'Recursion', depth: 1 }],
      sentence: 'Answered wrong in practice. It clears when you get another question on this topic right at Evaluate or above.',
    },
    ...ERRORS_REPLY.entries,
  ],
  counts: { open: ERRORS_REPLY.counts.open + 2, cleared: ERRORS_REPLY.counts.cleared },
};
