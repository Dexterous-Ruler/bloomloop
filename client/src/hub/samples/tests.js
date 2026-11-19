/**
 * Real replies for the self-test and Get Ready galleries (dev only, imported by
 * galleries only). Captured from the hub harness (:5050, the real server code
 * on the in-process store) on 2026-11-19: as asha (seeded), and as bilal
 * for the flows walked through the screens (a self-test across every kind, a
 * Get Ready check from start to path). Nothing here is made up; refusals are
 * the server's sentences with their status.
 */

/** GET /api/hub/exams as asha: one open (timed), one ended. */
export const EXAMS = {
  "exams": [
    {
      "id": "a6fb195cbd4c933877d032e4",
      "clientRunId": "asha-exam-bst-0001",
      "startedAt": "2026-11-19T15:02:19.059Z",
      "timeLimitMinutes": 180,
      "deadlineAt": "2026-11-19T18:02:19.059Z",
      "secondsLeft": 10798,
      "endedAt": null,
      "endReason": null,
      "status": "open",
      "topics": [
        {
          "id": "8e69d8f249667056eb6dfb0c",
          "name": "Binary search trees",
          "nameHtml": "Binary search trees"
        }
      ],
      "levels": [
        "remember",
        "understand",
        "apply",
        "analyse",
        "evaluate",
        "create"
      ],
      "total": 5,
      "answered": 1
    },
    {
      "id": "c3292ca41eaf8da7d69f81ee",
      "clientRunId": "asha-exam-complexity-01",
      "startedAt": "2026-11-14T12:30:00.005Z",
      "timeLimitMinutes": null,
      "deadlineAt": null,
      "secondsLeft": null,
      "endedAt": "2026-11-14T12:30:00.071Z",
      "endReason": "submitted",
      "status": "ended",
      "topics": [
        {
          "id": "125ef6334f42561087913d3c",
          "name": "Big-O notation",
          "nameHtml": "Big-O notation"
        },
        {
          "id": "3eebd882c9c83e5532acbb5c",
          "name": "Counting steps",
          "nameHtml": "Counting steps"
        }
      ],
      "levels": [
        "remember",
        "understand",
        "apply",
        "analyse",
        "evaluate",
        "create"
      ],
      "total": 3,
      "answered": 3,
      "right": 2,
      "sentence": "2 of 3 questions right."
    }
  ],
  "limits": {
    "maxQuestions": 30,
    "maxMinutes": 180,
    "graceSeconds": 30
  }
};

/** GET /api/hub/home as asha: the map the self-test picks topics from. */
export const HOME = {
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
    "not-started": 3,
    "not-sure": 2,
    "in-progress": 1,
    "mastered": 1,
    "needs-review": 4
  },
  "classes": [
    {
      "class": {
        "id": "22ba10f78bef3a4d591d03d3",
        "courseName": "Data Structures",
        "section": "SY CSE A",
        "termLabel": ""
      },
      "units": [
        {
          "id": "2f30cfcaa1b7f051dc93ee68",
          "name": "Unit 1: Recursion",
          "nameHtml": "Unit 1: Recursion",
          "chapters": [
            {
              "id": "c73583630a99de2b156a97ac",
              "title": "Recursion and the call stack",
              "titleHtml": "Recursion and the call stack",
              "topics": [
                {
                  "id": "585852683d4f8bf942941860",
                  "name": "Functions",
                  "nameHtml": "Functions",
                  "practiceQuestions": 8,
                  "state": {
                    "state": "mastered",
                    "label": "Mastered",
                    "answers": 7,
                    "provisional": false,
                    "outOf10": 9,
                    "sentence": "Mastered: from your 7 answers, you would likely get about 9 in 10 typical questions on this topic right."
                  },
                  "review": {
                    "due": false,
                    "dueAt": "2026-11-29T12:30:00.179Z",
                    "when": "on 2026-11-29"
                  }
                },
                {
                  "id": "6a6dce1e67338c30a717f72b",
                  "name": "The call stack",
                  "nameHtml": "The call stack",
                  "practiceQuestions": 6,
                  "state": {
                    "state": "needs-review",
                    "label": "Needs review",
                    "answers": 3,
                    "provisional": false,
                    "outOf10": 7,
                    "sentence": "Due for review: a short practice set now helps you keep this topic. In progress: from your 3 answers, you would likely get about 7 in 10 typical questions on this topic right. Mastered means about 8 in 10, from at least 5 answers."
                  },
                  "review": {
                    "due": true,
                    "dueAt": "2026-11-16T12:35:30.255Z",
                    "when": "now"
                  }
                },
                {
                  "id": "a2b219de965b391e364a5ddf",
                  "name": "Base case",
                  "nameHtml": "Base case",
                  "practiceQuestions": 6,
                  "state": {
                    "state": "in-progress",
                    "label": "In progress",
                    "answers": 3,
                    "provisional": false,
                    "outOf10": 9,
                    "sentence": "In progress: from your 3 answers, you would likely get about 9 in 10 typical questions on this topic right. Mastered needs at least 5 answers, so a few more will show it."
                  },
                  "review": {
                    "due": false,
                    "dueAt": "2026-12-03T12:02:18.973Z",
                    "when": "on 2026-12-03"
                  }
                },
                {
                  "id": "e1cfbf2707bd4637d090c225",
                  "name": "Recursion",
                  "nameHtml": "Recursion",
                  "practiceQuestions": 6,
                  "state": {
                    "state": "needs-review",
                    "label": "Needs review",
                    "answers": 4,
                    "provisional": false,
                    "outOf10": 3,
                    "sentence": "Due for review: a short practice set now helps you keep this topic. In progress: from your 4 answers, you would likely get about 3 in 10 typical questions on this topic right. Mastered means about 8 in 10, from at least 5 answers."
                  },
                  "review": {
                    "due": true,
                    "dueAt": "2026-11-16T12:31:00.692Z",
                    "when": "now"
                  }
                },
                {
                  "id": "1fab8e1ac1e302ba0d234198",
                  "name": "Recursion trees",
                  "nameHtml": "Recursion trees",
                  "practiceQuestions": 5,
                  "state": {
                    "state": "not-started",
                    "label": "Not started",
                    "answers": 0,
                    "provisional": true,
                    "outOf10": null,
                    "sentence": "You have not practised this topic yet."
                  },
                  "review": {
                    "due": false,
                    "dueAt": null,
                    "when": ""
                  }
                },
                {
                  "id": "f4217273ff04b587e08388fb",
                  "name": "Memoisation",
                  "nameHtml": "Memoisation",
                  "practiceQuestions": 5,
                  "state": {
                    "state": "not-started",
                    "label": "Not started",
                    "answers": 0,
                    "provisional": true,
                    "outOf10": null,
                    "sentence": "You have not practised this topic yet."
                  },
                  "review": {
                    "due": false,
                    "dueAt": null,
                    "when": ""
                  }
                }
              ]
            }
          ]
        },
        {
          "id": "5923d3651279d59d1b9bab1e",
          "name": "Unit 2: Trees, $O(\\log n)$ search",
          "nameHtml": "Unit 2: Trees, <math><mrow><mi>O</mi><mrow><mo fence=\"true\" form=\"prefix\" stretchy=\"false\">(</mo><mrow><mi>log</mi><mo>⁡</mo><mspace width=\"0.1667em\"></mspace></mrow><mi>n</mi><mo fence=\"true\" form=\"postfix\" stretchy=\"false\">)</mo></mrow></mrow></math> search",
          "chapters": [
            {
              "id": "d3e4fc12861b23decb44e6cf",
              "title": "Trees",
              "titleHtml": "Trees",
              "topics": [
                {
                  "id": "2a453abf607315a2e19c9fe0",
                  "name": "Binary trees",
                  "nameHtml": "Binary trees",
                  "practiceQuestions": 6,
                  "state": {
                    "state": "not-sure",
                    "label": "Not sure yet",
                    "answers": 2,
                    "provisional": true,
                    "outOf10": null,
                    "sentence": "Not sure yet: this rests on 2 answers. After 3 answers you get a first estimate."
                  },
                  "review": {
                    "due": false,
                    "dueAt": "2026-11-26T12:02:19.014Z",
                    "when": "on 2026-11-26"
                  }
                },
                {
                  "id": "f97df76c93f836a0e685c078",
                  "name": "Traversals",
                  "nameHtml": "Traversals",
                  "practiceQuestions": 5,
                  "state": {
                    "state": "not-sure",
                    "label": "Not sure yet",
                    "answers": 2,
                    "provisional": true,
                    "outOf10": null,
                    "sentence": "Not sure yet: this rests on 2 answers. After 3 answers you get a first estimate."
                  },
                  "review": {
                    "due": false,
                    "dueAt": "2026-11-30T12:02:18.998Z",
                    "when": "on 2026-11-30"
                  }
                },
                {
                  "id": "8e69d8f249667056eb6dfb0c",
                  "name": "Binary search trees",
                  "nameHtml": "Binary search trees",
                  "practiceQuestions": 5,
                  "state": {
                    "state": "not-started",
                    "label": "Not started",
                    "answers": 0,
                    "provisional": true,
                    "outOf10": null,
                    "sentence": "You have not practised this topic yet."
                  },
                  "review": {
                    "due": false,
                    "dueAt": null,
                    "when": ""
                  }
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
            "id": "4da14b38920ab90e9f4c36b0",
            "title": "Complexity",
            "titleHtml": "Complexity",
            "topics": [
              {
                "id": "125ef6334f42561087913d3c",
                "name": "Big-O notation",
                "nameHtml": "Big-O notation",
                "practiceQuestions": 2,
                "state": {
                  "state": "needs-review",
                  "label": "Needs review",
                  "answers": 2,
                  "provisional": true,
                  "outOf10": null,
                  "sentence": "Due for review: a short practice set now helps you keep this topic. Not sure yet: this rests on 2 answers. A first estimate needs answers to 3 different questions, and this topic does not have enough approved questions for that yet, so your professor needs to approve more."
                },
                "review": {
                  "due": true,
                  "dueAt": "2026-11-14T12:40:00.048Z",
                  "when": "now"
                }
              },
              {
                "id": "3eebd882c9c83e5532acbb5c",
                "name": "Counting steps",
                "nameHtml": "Counting steps",
                "practiceQuestions": 1,
                "state": {
                  "state": "needs-review",
                  "label": "Needs review",
                  "answers": 1,
                  "provisional": true,
                  "outOf10": null,
                  "sentence": "Due for review: a short practice set now helps you keep this topic. Not sure yet: this rests on 1 answer. A first estimate needs answers to 3 different questions, and this topic does not have enough approved questions for that yet, so your professor needs to approve more."
                },
                "review": {
                  "due": true,
                  "dueAt": "2026-11-14T12:31:00.026Z",
                  "when": "now"
                }
              }
            ]
          }
        ]
      }
    }
  ],
  "reviews": {
    "due": [
      {
        "id": "3eebd882c9c83e5532acbb5c",
        "name": "Counting steps",
        "nameHtml": "Counting steps",
        "chapter": {
          "id": "4da14b38920ab90e9f4c36b0",
          "title": "Complexity",
          "titleHtml": "Complexity"
        },
        "state": "needs-review",
        "label": "Needs review",
        "answers": 1,
        "review": {
          "due": true,
          "dueAt": "2026-11-14T12:31:00.026Z",
          "when": "now"
        }
      },
      {
        "id": "125ef6334f42561087913d3c",
        "name": "Big-O notation",
        "nameHtml": "Big-O notation",
        "chapter": {
          "id": "4da14b38920ab90e9f4c36b0",
          "title": "Complexity",
          "titleHtml": "Complexity"
        },
        "state": "needs-review",
        "label": "Needs review",
        "answers": 2,
        "review": {
          "due": true,
          "dueAt": "2026-11-14T12:40:00.048Z",
          "when": "now"
        }
      },
      {
        "id": "e1cfbf2707bd4637d090c225",
        "name": "Recursion",
        "nameHtml": "Recursion",
        "chapter": {
          "id": "c73583630a99de2b156a97ac",
          "title": "Recursion and the call stack",
          "titleHtml": "Recursion and the call stack"
        },
        "state": "needs-review",
        "label": "Needs review",
        "answers": 4,
        "review": {
          "due": true,
          "dueAt": "2026-11-16T12:31:00.692Z",
          "when": "now"
        }
      },
      {
        "id": "6a6dce1e67338c30a717f72b",
        "name": "The call stack",
        "nameHtml": "The call stack",
        "chapter": {
          "id": "c73583630a99de2b156a97ac",
          "title": "Recursion and the call stack",
          "titleHtml": "Recursion and the call stack"
        },
        "state": "needs-review",
        "label": "Needs review",
        "answers": 3,
        "review": {
          "due": true,
          "dueAt": "2026-11-16T12:35:30.255Z",
          "when": "now"
        }
      }
    ],
    "upcoming": [
      {
        "id": "2a453abf607315a2e19c9fe0",
        "name": "Binary trees",
        "nameHtml": "Binary trees",
        "chapter": {
          "id": "d3e4fc12861b23decb44e6cf",
          "title": "Trees",
          "titleHtml": "Trees"
        },
        "state": "not-sure",
        "label": "Not sure yet",
        "answers": 2,
        "review": {
          "due": false,
          "dueAt": "2026-11-26T12:02:19.014Z",
          "when": "on 2026-11-26"
        }
      }
    ],
    "setSize": 5,
    "rule": "A review is a short practice set on the topic. Its result sets when the topic comes back: under 40% right brings it back soonest, 40% to under 70% soon, 70% or more later, and 90% or more from at least 5 answers with no hint latest."
  },
  "goals": {
    "goals": [
      {
        "id": "f93b1f7cbd1126bd4f9640b1",
        "title": "Mid-semester test",
        "titleHtml": "Mid-semester test",
        "examDate": "2026-12-10",
        "daysLeft": 21,
        "past": false,
        "counts": {
          "not-started": 1,
          "not-sure": 1,
          "in-progress": 0,
          "mastered": 1,
          "needs-review": 2
        },
        "topics": [
          {
            "id": "585852683d4f8bf942941860",
            "name": "Functions",
            "nameHtml": "Functions",
            "chapter": {
              "id": "c73583630a99de2b156a97ac",
              "title": "Recursion and the call stack",
              "titleHtml": "Recursion and the call stack"
            },
            "state": {
              "state": "mastered",
              "label": "Mastered",
              "answers": 7,
              "provisional": false,
              "outOf10": 9,
              "sentence": "Mastered: from your 7 answers, you would likely get about 9 in 10 typical questions on this topic right."
            },
            "review": {
              "due": false,
              "dueAt": "2026-11-29T12:30:00.179Z",
              "when": "on 2026-11-29"
            }
          },
          {
            "id": "6a6dce1e67338c30a717f72b",
            "name": "The call stack",
            "nameHtml": "The call stack",
            "chapter": {
              "id": "c73583630a99de2b156a97ac",
              "title": "Recursion and the call stack",
              "titleHtml": "Recursion and the call stack"
            },
            "state": {
              "state": "needs-review",
              "label": "Needs review",
              "answers": 3,
              "provisional": false,
              "outOf10": 7,
              "sentence": "Due for review: a short practice set now helps you keep this topic. In progress: from your 3 answers, you would likely get about 7 in 10 typical questions on this topic right. Mastered means about 8 in 10, from at least 5 answers."
            },
            "review": {
              "due": true,
              "dueAt": "2026-11-16T12:35:30.255Z",
              "when": "now"
            }
          },
          {
            "id": "e1cfbf2707bd4637d090c225",
            "name": "Recursion",
            "nameHtml": "Recursion",
            "chapter": {
              "id": "c73583630a99de2b156a97ac",
              "title": "Recursion and the call stack",
              "titleHtml": "Recursion and the call stack"
            },
            "state": {
              "state": "needs-review",
              "label": "Needs review",
              "answers": 4,
              "provisional": false,
              "outOf10": 3,
              "sentence": "Due for review: a short practice set now helps you keep this topic. In progress: from your 4 answers, you would likely get about 3 in 10 typical questions on this topic right. Mastered means about 8 in 10, from at least 5 answers."
            },
            "review": {
              "due": true,
              "dueAt": "2026-11-16T12:31:00.692Z",
              "when": "now"
            }
          },
          {
            "id": "1fab8e1ac1e302ba0d234198",
            "name": "Recursion trees",
            "nameHtml": "Recursion trees",
            "chapter": {
              "id": "c73583630a99de2b156a97ac",
              "title": "Recursion and the call stack",
              "titleHtml": "Recursion and the call stack"
            },
            "state": {
              "state": "not-started",
              "label": "Not started",
              "answers": 0,
              "provisional": true,
              "outOf10": null,
              "sentence": "You have not practised this topic yet."
            },
            "review": {
              "due": false,
              "dueAt": null,
              "when": ""
            }
          },
          {
            "id": "2a453abf607315a2e19c9fe0",
            "name": "Binary trees",
            "nameHtml": "Binary trees",
            "chapter": {
              "id": "d3e4fc12861b23decb44e6cf",
              "title": "Trees",
              "titleHtml": "Trees"
            },
            "state": {
              "state": "not-sure",
              "label": "Not sure yet",
              "answers": 2,
              "provisional": true,
              "outOf10": null,
              "sentence": "Not sure yet: this rests on 2 answers. After 3 answers you get a first estimate."
            },
            "review": {
              "due": false,
              "dueAt": "2026-11-26T12:02:19.014Z",
              "when": "on 2026-11-26"
            }
          }
        ],
        "focus": [
          {
            "id": "6a6dce1e67338c30a717f72b",
            "name": "The call stack",
            "nameHtml": "The call stack",
            "state": "needs-review",
            "label": "Needs review"
          },
          {
            "id": "e1cfbf2707bd4637d090c225",
            "name": "Recursion",
            "nameHtml": "Recursion",
            "state": "needs-review",
            "label": "Needs review"
          },
          {
            "id": "2a453abf607315a2e19c9fe0",
            "name": "Binary trees",
            "nameHtml": "Binary trees",
            "state": "not-sure",
            "label": "Not sure yet"
          }
        ],
        "sentence": "1 of 5 topics mastered, 2 due for review, 1 not started. 21 days to go.",
        "createdAt": "2026-11-16T13:00:00.008Z",
        "updatedAt": "2026-11-16T13:00:00.008Z"
      }
    ],
    "note": "Only you see your goals.",
    "max": 10
  },
  "paths": {
    "paths": [
      {
        "checkId": "417d828f426c8841789e1cc7",
        "target": {
          "id": "1fab8e1ac1e302ba0d234198",
          "name": "Recursion trees",
          "nameHtml": "Recursion trees"
        },
        "endedAt": "2026-11-16T12:30:00.409Z",
        "steps": 1,
        "done": 0,
        "next": "e1cfbf2707bd4637d090c225",
        "nextName": "Recursion",
        "sentence": "0 of 1 refresher step done before \"Recursion trees\"."
      }
    ]
  },
  "weeks": {
    "weeks": [
      {
        "start": "2026-11-16",
        "end": "2026-11-22",
        "days": [
          {
            "day": "2026-11-16",
            "practised": true,
            "attempts": 11,
            "upcoming": false
          },
          {
            "day": "2026-11-17",
            "practised": true,
            "attempts": 6,
            "upcoming": false
          },
          {
            "day": "2026-11-18",
            "practised": true,
            "attempts": 1,
            "upcoming": false
          },
          {
            "day": "2026-11-19",
            "practised": true,
            "attempts": 4,
            "upcoming": false
          },
          {
            "day": "2026-11-20",
            "practised": false,
            "attempts": 0,
            "upcoming": true
          },
          {
            "day": "2026-11-21",
            "practised": false,
            "attempts": 0,
            "upcoming": true
          },
          {
            "day": "2026-11-22",
            "practised": false,
            "attempts": 0,
            "upcoming": true
          }
        ],
        "practisedDays": 4,
        "restDays": 0,
        "attempts": 22,
        "sentence": "This week you practised on 4 days."
      },
      {
        "start": "2026-11-09",
        "end": "2026-11-15",
        "days": [
          {
            "day": "2026-11-09",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-10",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-11",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-12",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-13",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-14",
            "practised": true,
            "attempts": 3,
            "upcoming": false
          },
          {
            "day": "2026-11-15",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          }
        ],
        "practisedDays": 1,
        "restDays": 6,
        "attempts": 3,
        "sentence": "You practised on 1 day and rested on 6 days."
      },
      {
        "start": "2026-11-02",
        "end": "2026-11-08",
        "days": [
          {
            "day": "2026-11-02",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-03",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-04",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-05",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-06",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-07",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-08",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          }
        ],
        "practisedDays": 0,
        "restDays": 7,
        "attempts": 0,
        "sentence": "A week of rest."
      },
      {
        "start": "2026-10-26",
        "end": "2026-11-01",
        "days": [
          {
            "day": "2026-10-26",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-10-27",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-10-28",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-10-29",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-10-30",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-10-31",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-01",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          }
        ],
        "practisedDays": 0,
        "restDays": 7,
        "attempts": 0,
        "sentence": "A week of rest."
      }
    ],
    "note": "Rest days are part of learning: a few short sessions spread over the week help more than one long one. Only you and your professor see this, and nothing here is compared with anyone else."
  }
};

/** GET /api/hub/home as cara (no activity). */
export const HOME_EMPTY = {
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
  "classes": [
    {
      "class": {
        "id": "22ba10f78bef3a4d591d03d3",
        "courseName": "Data Structures",
        "section": "SY CSE A",
        "termLabel": ""
      },
      "units": [
        {
          "id": "2f30cfcaa1b7f051dc93ee68",
          "name": "Unit 1: Recursion",
          "nameHtml": "Unit 1: Recursion",
          "chapters": [
            {
              "id": "c73583630a99de2b156a97ac",
              "title": "Recursion and the call stack",
              "titleHtml": "Recursion and the call stack",
              "topics": [
                {
                  "id": "585852683d4f8bf942941860",
                  "name": "Functions",
                  "nameHtml": "Functions",
                  "practiceQuestions": 8,
                  "state": {
                    "state": "not-started",
                    "label": "Not started",
                    "answers": 0,
                    "provisional": true,
                    "outOf10": null,
                    "sentence": "You have not practised this topic yet."
                  },
                  "review": {
                    "due": false,
                    "dueAt": null,
                    "when": ""
                  }
                },
                {
                  "id": "6a6dce1e67338c30a717f72b",
                  "name": "The call stack",
                  "nameHtml": "The call stack",
                  "practiceQuestions": 6,
                  "state": {
                    "state": "not-started",
                    "label": "Not started",
                    "answers": 0,
                    "provisional": true,
                    "outOf10": null,
                    "sentence": "You have not practised this topic yet."
                  },
                  "review": {
                    "due": false,
                    "dueAt": null,
                    "when": ""
                  }
                },
                {
                  "id": "a2b219de965b391e364a5ddf",
                  "name": "Base case",
                  "nameHtml": "Base case",
                  "practiceQuestions": 6,
                  "state": {
                    "state": "not-started",
                    "label": "Not started",
                    "answers": 0,
                    "provisional": true,
                    "outOf10": null,
                    "sentence": "You have not practised this topic yet."
                  },
                  "review": {
                    "due": false,
                    "dueAt": null,
                    "when": ""
                  }
                },
                {
                  "id": "e1cfbf2707bd4637d090c225",
                  "name": "Recursion",
                  "nameHtml": "Recursion",
                  "practiceQuestions": 6,
                  "state": {
                    "state": "not-started",
                    "label": "Not started",
                    "answers": 0,
                    "provisional": true,
                    "outOf10": null,
                    "sentence": "You have not practised this topic yet."
                  },
                  "review": {
                    "due": false,
                    "dueAt": null,
                    "when": ""
                  }
                },
                {
                  "id": "1fab8e1ac1e302ba0d234198",
                  "name": "Recursion trees",
                  "nameHtml": "Recursion trees",
                  "practiceQuestions": 5,
                  "state": {
                    "state": "not-started",
                    "label": "Not started",
                    "answers": 0,
                    "provisional": true,
                    "outOf10": null,
                    "sentence": "You have not practised this topic yet."
                  },
                  "review": {
                    "due": false,
                    "dueAt": null,
                    "when": ""
                  }
                },
                {
                  "id": "f4217273ff04b587e08388fb",
                  "name": "Memoisation",
                  "nameHtml": "Memoisation",
                  "practiceQuestions": 5,
                  "state": {
                    "state": "not-started",
                    "label": "Not started",
                    "answers": 0,
                    "provisional": true,
                    "outOf10": null,
                    "sentence": "You have not practised this topic yet."
                  },
                  "review": {
                    "due": false,
                    "dueAt": null,
                    "when": ""
                  }
                }
              ]
            }
          ]
        },
        {
          "id": "5923d3651279d59d1b9bab1e",
          "name": "Unit 2: Trees, $O(\\log n)$ search",
          "nameHtml": "Unit 2: Trees, <math><mrow><mi>O</mi><mrow><mo fence=\"true\" form=\"prefix\" stretchy=\"false\">(</mo><mrow><mi>log</mi><mo>⁡</mo><mspace width=\"0.1667em\"></mspace></mrow><mi>n</mi><mo fence=\"true\" form=\"postfix\" stretchy=\"false\">)</mo></mrow></mrow></math> search",
          "chapters": [
            {
              "id": "d3e4fc12861b23decb44e6cf",
              "title": "Trees",
              "titleHtml": "Trees",
              "topics": [
                {
                  "id": "2a453abf607315a2e19c9fe0",
                  "name": "Binary trees",
                  "nameHtml": "Binary trees",
                  "practiceQuestions": 6,
                  "state": {
                    "state": "not-started",
                    "label": "Not started",
                    "answers": 0,
                    "provisional": true,
                    "outOf10": null,
                    "sentence": "You have not practised this topic yet."
                  },
                  "review": {
                    "due": false,
                    "dueAt": null,
                    "when": ""
                  }
                },
                {
                  "id": "f97df76c93f836a0e685c078",
                  "name": "Traversals",
                  "nameHtml": "Traversals",
                  "practiceQuestions": 5,
                  "state": {
                    "state": "not-started",
                    "label": "Not started",
                    "answers": 0,
                    "provisional": true,
                    "outOf10": null,
                    "sentence": "You have not practised this topic yet."
                  },
                  "review": {
                    "due": false,
                    "dueAt": null,
                    "when": ""
                  }
                },
                {
                  "id": "8e69d8f249667056eb6dfb0c",
                  "name": "Binary search trees",
                  "nameHtml": "Binary search trees",
                  "practiceQuestions": 5,
                  "state": {
                    "state": "not-started",
                    "label": "Not started",
                    "answers": 0,
                    "provisional": true,
                    "outOf10": null,
                    "sentence": "You have not practised this topic yet."
                  },
                  "review": {
                    "due": false,
                    "dueAt": null,
                    "when": ""
                  }
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
            "id": "4da14b38920ab90e9f4c36b0",
            "title": "Complexity",
            "titleHtml": "Complexity",
            "topics": [
              {
                "id": "125ef6334f42561087913d3c",
                "name": "Big-O notation",
                "nameHtml": "Big-O notation",
                "practiceQuestions": 2,
                "state": {
                  "state": "not-started",
                  "label": "Not started",
                  "answers": 0,
                  "provisional": true,
                  "outOf10": null,
                  "sentence": "You have not practised this topic yet."
                },
                "review": {
                  "due": false,
                  "dueAt": null,
                  "when": ""
                }
              },
              {
                "id": "3eebd882c9c83e5532acbb5c",
                "name": "Counting steps",
                "nameHtml": "Counting steps",
                "practiceQuestions": 1,
                "state": {
                  "state": "not-started",
                  "label": "Not started",
                  "answers": 0,
                  "provisional": true,
                  "outOf10": null,
                  "sentence": "You have not practised this topic yet."
                },
                "review": {
                  "due": false,
                  "dueAt": null,
                  "when": ""
                }
              }
            ]
          }
        ]
      }
    }
  ],
  "reviews": {
    "due": [],
    "upcoming": [],
    "setSize": 5,
    "rule": "A review is a short practice set on the topic. Its result sets when the topic comes back: under 40% right brings it back soonest, 40% to under 70% soon, 70% or more later, and 90% or more from at least 5 answers with no hint latest."
  },
  "goals": {
    "goals": [],
    "note": "Only you see your goals.",
    "max": 10
  },
  "paths": {
    "paths": []
  },
  "weeks": {
    "weeks": [
      {
        "start": "2026-11-16",
        "end": "2026-11-22",
        "days": [
          {
            "day": "2026-11-16",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-17",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-18",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-19",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-20",
            "practised": false,
            "attempts": 0,
            "upcoming": true
          },
          {
            "day": "2026-11-21",
            "practised": false,
            "attempts": 0,
            "upcoming": true
          },
          {
            "day": "2026-11-22",
            "practised": false,
            "attempts": 0,
            "upcoming": true
          }
        ],
        "practisedDays": 0,
        "restDays": 4,
        "attempts": 0,
        "sentence": "No practice yet this week."
      },
      {
        "start": "2026-11-09",
        "end": "2026-11-15",
        "days": [
          {
            "day": "2026-11-09",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-10",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-11",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-12",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-13",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-14",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-15",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          }
        ],
        "practisedDays": 0,
        "restDays": 7,
        "attempts": 0,
        "sentence": "A week of rest."
      },
      {
        "start": "2026-11-02",
        "end": "2026-11-08",
        "days": [
          {
            "day": "2026-11-02",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-03",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-04",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-05",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-06",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-07",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-08",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          }
        ],
        "practisedDays": 0,
        "restDays": 7,
        "attempts": 0,
        "sentence": "A week of rest."
      },
      {
        "start": "2026-10-26",
        "end": "2026-11-01",
        "days": [
          {
            "day": "2026-10-26",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-10-27",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-10-28",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-10-29",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-10-30",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-10-31",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          },
          {
            "day": "2026-11-01",
            "practised": false,
            "attempts": 0,
            "upcoming": false
          }
        ],
        "practisedDays": 0,
        "restDays": 7,
        "attempts": 0,
        "sentence": "A week of rest."
      }
    ],
    "note": "Rest days are part of learning: a few short sessions spread over the week help more than one long one. Only you and your professor see this, and nothing here is compared with anyone else."
  }
};

/** GET /api/hub/exams/:id as asha: open, timed 180 minutes, one answer saved. */
export const EXAM_OPEN = {
  "exam": {
    "id": "a6fb195cbd4c933877d032e4",
    "clientRunId": "asha-exam-bst-0001",
    "startedAt": "2026-11-19T15:02:19.059Z",
    "timeLimitMinutes": 180,
    "deadlineAt": "2026-11-19T18:02:19.059Z",
    "secondsLeft": 10798,
    "endedAt": null,
    "endReason": null,
    "status": "open",
    "topics": [
      {
        "id": "8e69d8f249667056eb6dfb0c",
        "name": "Binary search trees",
        "nameHtml": "Binary search trees"
      }
    ],
    "levels": [
      "remember",
      "understand",
      "apply",
      "analyse",
      "evaluate",
      "create"
    ],
    "total": 5
  },
  "questions": [
    {
      "position": 1,
      "questionId": "2c070ba34b3b46540ce86e77",
      "topic": {
        "id": "8e69d8f249667056eb6dfb0c",
        "name": "Binary search trees"
      },
      "question": {
        "_id": "2c070ba34b3b46540ce86e77",
        "text": "In a binary search tree, where are the keys smaller than a node?",
        "bloom": "remember",
        "topic": "Binary search trees",
        "kind": "mcq",
        "source": "teacher",
        "options": [
          "In its left subtree",
          "In its right subtree",
          "Above it",
          "Anywhere"
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
      "answered": true,
      "response": 0,
      "answeredAt": "2026-11-19T15:02:19.069Z"
    },
    {
      "position": 2,
      "questionId": "9a3adc936f85210ed596882f",
      "topic": {
        "id": "8e69d8f249667056eb6dfb0c",
        "name": "Binary search trees"
      },
      "question": {
        "_id": "9a3adc936f85210ed596882f",
        "text": "To find 40 in a tree whose root is 50 and whose root's left child is 30: at 50 go ____, then at 30 go ____.",
        "bloom": "apply",
        "topic": "Binary search trees",
        "kind": "cloze",
        "source": "teacher",
        "blankCount": 2,
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
      "answered": false,
      "response": null,
      "answeredAt": null
    },
    {
      "position": 3,
      "questionId": "d2c97b50453114398df32a9a",
      "topic": {
        "id": "8e69d8f249667056eb6dfb0c",
        "name": "Binary search trees"
      },
      "question": {
        "_id": "d2c97b50453114398df32a9a",
        "text": "Sort the keys by the subtree of root 50 they belong in.",
        "bloom": "understand",
        "topic": "Binary search trees",
        "kind": "categorise",
        "source": "teacher",
        "groups": [
          "Left subtree",
          "Right subtree"
        ],
        "items": [
          "90",
          "35",
          "60",
          "20"
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
      "answered": false,
      "response": null,
      "answeredAt": null
    },
    {
      "position": 4,
      "questionId": "caa4621ed7105f23442553b7",
      "topic": {
        "id": "8e69d8f249667056eb6dfb0c",
        "name": "Binary search trees"
      },
      "question": {
        "_id": "caa4621ed7105f23442553b7",
        "text": "A binary search tree has root 50. Fill in which side of the root each new key goes.",
        "bloom": "apply",
        "topic": "Binary search trees",
        "kind": "table",
        "source": "teacher",
        "columns": [
          "Key",
          "Side of 50"
        ],
        "rows": [
          {
            "header": "Insert 30",
            "cells": [
              {
                "given": "30"
              },
              {
                "blank": true
              }
            ]
          },
          {
            "header": "Insert 70",
            "cells": [
              {
                "given": "70"
              },
              {
                "blank": true
              }
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
      "language": "en",
      "translationId": null,
      "languageNote": null,
      "answered": false,
      "response": null,
      "answeredAt": null
    },
    {
      "position": 5,
      "questionId": "6c7e037928d1391d3fcd5a0b",
      "topic": {
        "id": "8e69d8f249667056eb6dfb0c",
        "name": "Binary search trees"
      },
      "question": {
        "_id": "6c7e037928d1391d3fcd5a0b",
        "text": "Searching a binary search tree of height $h$ takes $O(h)$ steps.",
        "bloom": "remember",
        "topic": "Binary search trees",
        "kind": "truefalse",
        "source": "teacher",
        "provenance": {
          "by": "professor",
          "checked": true,
          "text": "Written by your professor."
        },
        "rich": {
          "text": "Searching a binary search tree of height <math><mi>h</mi></math> takes <math><mrow><mi>O</mi><mrow><mo fence=\"true\" form=\"prefix\" stretchy=\"false\">(</mo><mi>h</mi><mo fence=\"true\" form=\"postfix\" stretchy=\"false\">)</mo></mrow></mrow></math> steps."
        }
      },
      "language": "en",
      "translationId": null,
      "languageNote": null,
      "answered": false,
      "response": null,
      "answeredAt": null
    }
  ],
  "answered": 1,
  "hints": {
    "available": 0,
    "note": "No hints in a self-test."
  },
  "note": "Your answers are saved as you go. You see what was right, and why, once you hand it in (or its time runs out, which hands in what you answered)."
};

/** POST /api/hub/exams/:id/answers as bilal (a change of answer): saved, and nothing else. */
export const EXAM_ANSWER = {
  "saved": true,
  "duplicate": false,
  "late": false,
  "attempt": {
    "id": "9fd594d41c4bc8b9dea98bbc",
    "attemptId": "8a923d88-4f99-49e9-be64-65d5cc7642cb",
    "createdAt": "2026-11-19T14:44:31.349Z"
  },
  "answered": 1,
  "total": 10,
  "status": "open"
};

/** GET /api/hub/exams/:id as asha: handed in (Binary trees, Traversals). */
export const EXAM_ENDED = {
  "exam": {
    "id": "c3292ca41eaf8da7d69f81ee",
    "clientRunId": "asha-exam-complexity-01",
    "startedAt": "2026-11-14T12:30:00.005Z",
    "timeLimitMinutes": null,
    "deadlineAt": null,
    "secondsLeft": null,
    "endedAt": "2026-11-14T12:30:00.071Z",
    "endReason": "submitted",
    "status": "ended",
    "topics": [
      {
        "id": "125ef6334f42561087913d3c",
        "name": "Big-O notation",
        "nameHtml": "Big-O notation"
      },
      {
        "id": "3eebd882c9c83e5532acbb5c",
        "name": "Counting steps",
        "nameHtml": "Counting steps"
      }
    ],
    "levels": [
      "remember",
      "understand",
      "apply",
      "analyse",
      "evaluate",
      "create"
    ],
    "total": 3
  },
  "ended": "You handed this self-test in.",
  "questions": [
    {
      "position": 1,
      "questionId": "be8c64f02dfd5e514cbda3db",
      "topicId": "3eebd882c9c83e5532acbb5c",
      "topic": {
        "id": "3eebd882c9c83e5532acbb5c",
        "name": "Counting steps",
        "nameHtml": "Counting steps"
      },
      "bloom": "apply",
      "levelLabel": "Apply",
      "question": {
        "text": "How many times does `body()` run? ```python for i in range(3): for j in range(4): body() ```",
        "bloom": "apply",
        "topic": "Counting steps",
        "kind": "numeric",
        "source": "teacher",
        "unit": "",
        "rich": {}
      },
      "answered": true,
      "response": 19,
      "correct": false,
      "score": 0,
      "detail": "exact",
      "mark": "auto",
      "markLabel": "Marked by the computer from your professor's answer.",
      "solution": 12,
      "explanation": null,
      "optionFeedback": []
    },
    {
      "position": 2,
      "questionId": "cf2aaf31583cfaba020d6ec0",
      "topicId": "125ef6334f42561087913d3c",
      "topic": {
        "id": "125ef6334f42561087913d3c",
        "name": "Big-O notation",
        "nameHtml": "Big-O notation"
      },
      "bloom": "remember",
      "levelLabel": "Remember",
      "question": {
        "text": "$O(n)$ means the steps grow at most linearly with $n$, up to a constant factor.",
        "bloom": "remember",
        "topic": "Big-O notation",
        "kind": "truefalse",
        "source": "teacher",
        "rich": {
          "text": "<math><mrow><mi>O</mi><mrow><mo fence=\"true\" form=\"prefix\" stretchy=\"false\">(</mo><mi>n</mi><mo fence=\"true\" form=\"postfix\" stretchy=\"false\">)</mo></mrow></mrow></math> means the steps grow at most linearly with <math><mi>n</mi></math>, up to a constant factor."
        }
      },
      "answered": true,
      "response": true,
      "correct": true,
      "score": 1,
      "detail": "",
      "mark": "auto",
      "markLabel": "Marked by the computer from your professor's answer.",
      "solution": true,
      "explanation": null,
      "optionFeedback": []
    },
    {
      "position": 3,
      "questionId": "62a4ad3028f0a9beade35fc3",
      "topicId": "125ef6334f42561087913d3c",
      "topic": {
        "id": "125ef6334f42561087913d3c",
        "name": "Big-O notation",
        "nameHtml": "Big-O notation"
      },
      "bloom": "remember",
      "levelLabel": "Remember",
      "question": {
        "text": "Which grows fastest as $n$ grows?",
        "bloom": "remember",
        "topic": "Big-O notation",
        "kind": "mcq",
        "source": "teacher",
        "options": [
          "$2^n$",
          "$n^2$",
          "$n \\log n$",
          "$n$"
        ],
        "rich": {
          "text": "Which grows fastest as <math><mi>n</mi></math> grows?",
          "options": [
            "<math><msup><mn>2</mn><mi>n</mi></msup></math>",
            "<math><msup><mi>n</mi><mn>2</mn></msup></math>",
            "<math><mrow><mi>n</mi><mrow><mspace width=\"0.1667em\"></mspace><mi>log</mi><mo>⁡</mo><mspace width=\"0.1667em\"></mspace></mrow><mi>n</mi></mrow></math>",
            "<math><mi>n</mi></math>"
          ]
        }
      },
      "answered": true,
      "response": 0,
      "correct": true,
      "score": 1,
      "detail": "",
      "mark": "auto",
      "markLabel": "Marked by the computer from your professor's answer.",
      "solution": 0,
      "explanation": null,
      "optionFeedback": []
    }
  ],
  "summary": {
    "overall": {
      "questions": 3,
      "answered": 3,
      "right": 2,
      "provisional": 0,
      "unmarked": 0,
      "sentence": "2 of 3 questions right."
    },
    "byTopic": [
      {
        "topic": {
          "id": "125ef6334f42561087913d3c",
          "name": "Big-O notation"
        },
        "questions": 2,
        "answered": 2,
        "right": 2,
        "provisional": 0,
        "unmarked": 0,
        "sentence": "2 of 2 questions right."
      },
      {
        "topic": {
          "id": "3eebd882c9c83e5532acbb5c",
          "name": "Counting steps"
        },
        "questions": 1,
        "answered": 1,
        "right": 0,
        "provisional": 0,
        "unmarked": 0,
        "sentence": "0 of 1 question right."
      }
    ],
    "byLevel": [
      {
        "level": "remember",
        "label": "Remember",
        "questions": 2,
        "answered": 2,
        "right": 2,
        "provisional": 0,
        "unmarked": 0,
        "sentence": "2 of 2 questions right."
      },
      {
        "level": "apply",
        "label": "Apply",
        "questions": 1,
        "answered": 1,
        "right": 0,
        "provisional": 0,
        "unmarked": 0,
        "sentence": "0 of 1 question right."
      }
    ]
  },
  "note": "A self-test counts in no class mark, attainment figure or register, and nobody is compared with you. Once it is handed in, its answers count in your own progress in the hub, which your professor can see."
};

/** POST /api/hub/exams/:id/submit as bilal: every kind, one unanswered, one provisional. */
export const EXAM_ENDED_KINDS = {
  "exam": {
    "id": "8180ad22fd86f9726260d51d",
    "clientRunId": "cdd65254-1a61-4a99-9457-fa06fb3287b8",
    "startedAt": "2026-11-19T14:46:11.260Z",
    "timeLimitMinutes": null,
    "deadlineAt": null,
    "secondsLeft": null,
    "endedAt": "2026-11-19T14:49:09.327Z",
    "endReason": "submitted",
    "status": "ended",
    "topics": [
      {
        "id": "ec9414d6221be5eab7331746",
        "name": "Recursion trees",
        "nameHtml": "Recursion trees"
      },
      {
        "id": "dcfec25b2a5b4168a99487c3",
        "name": "Memoisation",
        "nameHtml": "Memoisation"
      }
    ],
    "levels": [
      "remember",
      "understand",
      "apply",
      "analyse",
      "evaluate",
      "create"
    ],
    "total": 10
  },
  "ended": "You handed this self-test in.",
  "questions": [
    {
      "position": 1,
      "questionId": "ba08ea1ed358bd4cb0534dce",
      "topicId": "dcfec25b2a5b4168a99487c3",
      "topic": {
        "id": "dcfec25b2a5b4168a99487c3",
        "name": "Memoisation",
        "nameHtml": "Memoisation"
      },
      "bloom": "evaluate",
      "levelLabel": "Evaluate",
      "question": {
        "text": "Rank these ways of computing `fib(30)`.",
        "bloom": "evaluate",
        "topic": "Memoisation",
        "kind": "rank",
        "source": "teacher",
        "criterion": "least work first",
        "items": [
          "Naive recursion",
          "A loop from 0 to 30",
          "Memoised recursion"
        ],
        "rich": {}
      },
      "answered": true,
      "response": [
        0,
        1,
        2
      ],
      "correct": false,
      "score": 0.5,
      "detail": "1/2 in sequence",
      "mark": "auto",
      "markLabel": "Marked by the computer from your professor's answer.",
      "solution": [
        "A loop from 0 to 30",
        "Memoised recursion",
        "Naive recursion"
      ],
      "explanation": null,
      "optionFeedback": []
    },
    {
      "position": 2,
      "questionId": "038c34210bc663e0effc9e3c",
      "topicId": "dcfec25b2a5b4168a99487c3",
      "topic": {
        "id": "dcfec25b2a5b4168a99487c3",
        "name": "Memoisation",
        "nameHtml": "Memoisation"
      },
      "bloom": "remember",
      "levelLabel": "Remember",
      "question": {
        "text": "Memoised Fibonacci makes $O(n)$ calls.",
        "bloom": "remember",
        "topic": "Memoisation",
        "kind": "truefalse",
        "source": "teacher",
        "rich": {
          "text": "Memoised Fibonacci makes <math><mrow><mi>O</mi><mrow><mo fence=\"true\" form=\"prefix\" stretchy=\"false\">(</mo><mi>n</mi><mo fence=\"true\" form=\"postfix\" stretchy=\"false\">)</mo></mrow></mrow></math> calls."
        }
      },
      "answered": true,
      "response": true,
      "correct": true,
      "score": 1,
      "detail": "",
      "mark": "auto",
      "markLabel": "Marked by the computer from your professor's answer.",
      "solution": true,
      "explanation": null,
      "optionFeedback": []
    },
    {
      "position": 3,
      "questionId": "cfb6ad4b7657dc33a5b7f26d",
      "topicId": "ec9414d6221be5eab7331746",
      "topic": {
        "id": "ec9414d6221be5eab7331746",
        "name": "Recursion trees",
        "nameHtml": "Recursion trees"
      },
      "bloom": "remember",
      "levelLabel": "Remember",
      "question": {
        "text": "In a recursion tree, what does one node stand for?",
        "bloom": "remember",
        "topic": "Recursion trees",
        "kind": "mcq",
        "source": "teacher",
        "options": [
          "One call",
          "One line of code",
          "One variable",
          "One loop"
        ],
        "rich": {}
      },
      "answered": true,
      "response": 0,
      "correct": true,
      "score": 1,
      "detail": "",
      "mark": "auto",
      "markLabel": "Marked by the computer from your professor's answer.",
      "solution": 0,
      "explanation": null,
      "optionFeedback": []
    },
    {
      "position": 4,
      "questionId": "96680e6ea7a64353c9a217cb",
      "topicId": "dcfec25b2a5b4168a99487c3",
      "topic": {
        "id": "dcfec25b2a5b4168a99487c3",
        "name": "Memoisation",
        "nameHtml": "Memoisation"
      },
      "bloom": "create",
      "levelLabel": "Create",
      "question": {
        "text": "In two or three sentences, explain why memoisation makes naive Fibonacci fast.",
        "bloom": "create",
        "topic": "Memoisation",
        "kind": "open",
        "source": "teacher",
        "hint": "3 points to cover",
        "rich": {}
      },
      "answered": true,
      "response": "It stores each result the first time, so repeated calls return at once instead of recomputing the whole subtree.",
      "correct": false,
      "score": 0.667,
      "detail": "2/3 rubric points",
      "mark": "provisional",
      "markLabel": "This written answer was marked by matching its words against your professor's points. It is a provisional machine mark, not your professor's.",
      "solution": [
        "Naive recursion computes the same calls many times",
        "A memo keeps each result once it is computed",
        "Later calls read the kept result instead of computing it again"
      ],
      "explanation": null,
      "optionFeedback": []
    },
    {
      "position": 5,
      "questionId": "ba8b7eda01446dfab9d177eb",
      "topicId": "dcfec25b2a5b4168a99487c3",
      "topic": {
        "id": "dcfec25b2a5b4168a99487c3",
        "name": "Memoisation",
        "nameHtml": "Memoisation"
      },
      "bloom": "analyse",
      "levelLabel": "Analyse",
      "question": {
        "text": "Pick the word that names what a memo keeps.",
        "bloom": "analyse",
        "topic": "Memoisation",
        "kind": "hottext",
        "source": "teacher",
        "tokens": [
          "A",
          "memo",
          "keeps",
          "each",
          "result",
          "under",
          "its",
          "input"
        ],
        "criterion": "the word naming what is kept",
        "rich": {}
      },
      "answered": true,
      "response": [
        4
      ],
      "correct": true,
      "score": 1,
      "detail": "1/1 words",
      "mark": "auto",
      "markLabel": "Marked by the computer from your professor's answer.",
      "solution": [
        4
      ],
      "explanation": null,
      "optionFeedback": []
    },
    {
      "position": 6,
      "questionId": "9679e17e58e2bb5aa33b918c",
      "topicId": "ec9414d6221be5eab7331746",
      "topic": {
        "id": "ec9414d6221be5eab7331746",
        "name": "Recursion trees",
        "nameHtml": "Recursion trees"
      },
      "bloom": "apply",
      "levelLabel": "Apply",
      "question": {
        "text": "Naive `fib(n)` calls `fib(n - 1)` and `fib(n - 2)`; `fib(0)` and `fib(1)` return at once. How many calls does `fib(4)` make in all, counting itself?",
        "bloom": "apply",
        "topic": "Recursion trees",
        "kind": "numeric",
        "source": "teacher",
        "unit": "",
        "rich": {}
      },
      "answered": true,
      "response": "15",
      "correct": false,
      "score": 0,
      "detail": "exact",
      "mark": "auto",
      "markLabel": "Marked by the computer from your professor's answer.",
      "solution": 9,
      "explanation": null,
      "optionFeedback": []
    },
    {
      "position": 7,
      "questionId": "624527473422360fe5bb51bc",
      "topicId": "ec9414d6221be5eab7331746",
      "topic": {
        "id": "ec9414d6221be5eab7331746",
        "name": "Recursion trees",
        "nameHtml": "Recursion trees"
      },
      "bloom": "understand",
      "levelLabel": "Understand",
      "question": {
        "text": "Sort the calls of naive `fib(3)`: which are leaves of its recursion tree?",
        "bloom": "understand",
        "topic": "Recursion trees",
        "kind": "categorise",
        "source": "teacher",
        "groups": [
          "A leaf: returns at once",
          "Makes more calls"
        ],
        "items": [
          "fib(0)",
          "fib(1)",
          "fib(3)",
          "fib(2)"
        ],
        "rich": {}
      },
      "answered": false,
      "response": null,
      "correct": null,
      "score": null,
      "detail": "",
      "mark": "unmarked",
      "markLabel": "Not answered, so not marked. Its answer is shown once you have tried it, in practice or in another self-test.",
      "solution": null,
      "explanation": null,
      "optionFeedback": []
    },
    {
      "position": 8,
      "questionId": "e675f4cc03d058b9831a11b8",
      "topicId": "ec9414d6221be5eab7331746",
      "topic": {
        "id": "ec9414d6221be5eab7331746",
        "name": "Recursion trees",
        "nameHtml": "Recursion trees"
      },
      "bloom": "analyse",
      "levelLabel": "Analyse",
      "question": {
        "text": "For naive `fib(3)`, tick what holds for each call.",
        "bloom": "analyse",
        "topic": "Recursion trees",
        "kind": "grid",
        "source": "teacher",
        "rows": [
          "fib(2)",
          "fib(1)",
          "fib(0)"
        ],
        "columns": [
          "Called directly by fib(3)",
          "Called at some point"
        ],
        "rich": {}
      },
      "answered": true,
      "response": {
        "0:0": true
      },
      "correct": false,
      "score": 0.6,
      "detail": "1/5 ticked, 0 wrongly ticked",
      "mark": "auto",
      "markLabel": "Marked by the computer from your professor's answer.",
      "solution": [
        "0:0",
        "0:1",
        "1:0",
        "1:1",
        "2:1"
      ],
      "explanation": null,
      "optionFeedback": []
    },
    {
      "position": 9,
      "questionId": "4fd758a2ccc76a37efaac37d",
      "topicId": "dcfec25b2a5b4168a99487c3",
      "topic": {
        "id": "dcfec25b2a5b4168a99487c3",
        "name": "Memoisation",
        "nameHtml": "Memoisation"
      },
      "bloom": "remember",
      "levelLabel": "Remember",
      "question": {
        "text": "What does memoisation store?",
        "bloom": "remember",
        "topic": "Memoisation",
        "kind": "mcq",
        "source": "teacher",
        "options": [
          "Each result, the first time it is computed",
          "Each line of the program",
          "The whole call stack",
          "Nothing at all"
        ],
        "rich": {}
      },
      "answered": true,
      "response": 0,
      "correct": true,
      "score": 1,
      "detail": "",
      "mark": "auto",
      "markLabel": "Marked by the computer from your professor's answer.",
      "solution": 0,
      "explanation": null,
      "optionFeedback": []
    },
    {
      "position": 10,
      "questionId": "f3db6bbfdaf38bb68c1216c8",
      "topicId": "ec9414d6221be5eab7331746",
      "topic": {
        "id": "ec9414d6221be5eab7331746",
        "name": "Recursion trees",
        "nameHtml": "Recursion trees"
      },
      "bloom": "evaluate",
      "levelLabel": "Evaluate",
      "question": {
        "text": "Put the first four calls of naive `fib(3)` in the order they start.",
        "bloom": "evaluate",
        "topic": "Recursion trees",
        "kind": "order",
        "source": "teacher",
        "items": [
          "fib(3)",
          "fib(0)",
          "fib(2)",
          "fib(1)"
        ],
        "rich": {}
      },
      "answered": true,
      "response": [
        0,
        1,
        2,
        3
      ],
      "correct": false,
      "score": 0.667,
      "detail": "2/3 in sequence",
      "mark": "auto",
      "markLabel": "Marked by the computer from your professor's answer.",
      "solution": [
        "fib(3)",
        "fib(2)",
        "fib(1)",
        "fib(0)"
      ],
      "explanation": null,
      "optionFeedback": []
    }
  ],
  "summary": {
    "overall": {
      "questions": 10,
      "answered": 9,
      "right": 4,
      "provisional": 1,
      "unmarked": 1,
      "sentence": "4 of 10 questions right; 1 not answered; 1 written answer with a provisional machine mark."
    },
    "byTopic": [
      {
        "topic": {
          "id": "ec9414d6221be5eab7331746",
          "name": "Recursion trees"
        },
        "questions": 5,
        "answered": 4,
        "right": 1,
        "provisional": 0,
        "unmarked": 1,
        "sentence": "1 of 5 questions right; 1 not answered."
      },
      {
        "topic": {
          "id": "dcfec25b2a5b4168a99487c3",
          "name": "Memoisation"
        },
        "questions": 5,
        "answered": 5,
        "right": 3,
        "provisional": 1,
        "unmarked": 0,
        "sentence": "3 of 5 questions right; 1 written answer with a provisional machine mark."
      }
    ],
    "byLevel": [
      {
        "level": "remember",
        "label": "Remember",
        "questions": 3,
        "answered": 3,
        "right": 3,
        "provisional": 0,
        "unmarked": 0,
        "sentence": "3 of 3 questions right."
      },
      {
        "level": "understand",
        "label": "Understand",
        "questions": 1,
        "answered": 0,
        "right": 0,
        "provisional": 0,
        "unmarked": 1,
        "sentence": "0 of 1 question right; 1 not answered."
      },
      {
        "level": "apply",
        "label": "Apply",
        "questions": 1,
        "answered": 1,
        "right": 0,
        "provisional": 0,
        "unmarked": 0,
        "sentence": "0 of 1 question right."
      },
      {
        "level": "analyse",
        "label": "Analyse",
        "questions": 2,
        "answered": 2,
        "right": 1,
        "provisional": 0,
        "unmarked": 0,
        "sentence": "1 of 2 questions right."
      },
      {
        "level": "evaluate",
        "label": "Evaluate",
        "questions": 2,
        "answered": 2,
        "right": 0,
        "provisional": 0,
        "unmarked": 0,
        "sentence": "0 of 2 questions right."
      },
      {
        "level": "create",
        "label": "Create",
        "questions": 1,
        "answered": 1,
        "right": 0,
        "provisional": 1,
        "unmarked": 0,
        "sentence": "0 of 1 question right; 1 written answer with a provisional machine mark."
      }
    ]
  },
  "note": "A self-test counts in no class mark, attainment figure or register, and nobody is compared with you. Once it is handed in, its answers count in your own progress in the hub, which your professor can see."
};

/** GET /api/hub/getready as asha: one open, one complete. */
export const READY_CHECKS = {
  "checks": [
    {
      "id": "4d86822e00aee08455f53086",
      "clientRunId": "asha-check-bst-00001",
      "target": {
        "id": "8e69d8f249667056eb6dfb0c",
        "name": "Binary search trees",
        "nameHtml": "Binary search trees"
      },
      "startedAt": "2026-11-18T12:30:00.015Z",
      "endedAt": null,
      "status": "open",
      "asked": 1,
      "counts": {
        "ready": 0,
        "needs-review": 0,
        "not-sure": 0
      },
      "sentence": "Checking the topics \"Binary search trees\" needs first: 1 question asked of at most 12."
    },
    {
      "id": "417d828f426c8841789e1cc7",
      "clientRunId": "asha-check-recursion-trees",
      "target": {
        "id": "1fab8e1ac1e302ba0d234198",
        "name": "Recursion trees",
        "nameHtml": "Recursion trees"
      },
      "startedAt": "2026-11-16T12:30:00.017Z",
      "endedAt": "2026-11-16T12:30:00.409Z",
      "status": "complete",
      "asked": 9,
      "counts": {
        "ready": 3,
        "needs-review": 1,
        "not-sure": 1
      },
      "sentence": "1 prerequisite needs review first; the refresher path goes through it and then to \"Recursion trees\". 1 is not sure yet; practising it helps too."
    }
  ],
  "rule": "The check asks at most 12 questions, about the topics this one needs first, nearest first. Two right answers in a row on a topic make it Ready and two wrong make it Needs review; after one of each, a third question decides (two of three right is Ready). A topic you have already mastered in practice is Ready without asking. A topic the check could not decide is Not sure yet."
};

/** GET /api/hub/topics/:id as asha (Recursion trees): its prerequisites, nearest first. */
export const READY_TOPIC = {
  "topic": {
    "id": "1fab8e1ac1e302ba0d234198",
    "name": "Recursion trees",
    "nameHtml": "Recursion trees",
    "chapter": {
      "id": "c73583630a99de2b156a97ac",
      "title": "Recursion and the call stack",
      "titleHtml": "Recursion and the call stack"
    }
  },
  "prerequisites": [
    {
      "id": "e1cfbf2707bd4637d090c225",
      "name": "Recursion",
      "nameHtml": "Recursion",
      "chapter": {
        "id": "c73583630a99de2b156a97ac",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 1,
      "via": [
        "1fab8e1ac1e302ba0d234198"
      ],
      "onYourClasses": true
    },
    {
      "id": "6a6dce1e67338c30a717f72b",
      "name": "The call stack",
      "nameHtml": "The call stack",
      "chapter": {
        "id": "c73583630a99de2b156a97ac",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 2,
      "via": [
        "e1cfbf2707bd4637d090c225"
      ],
      "onYourClasses": true
    },
    {
      "id": "a2b219de965b391e364a5ddf",
      "name": "Base case",
      "nameHtml": "Base case",
      "chapter": {
        "id": "c73583630a99de2b156a97ac",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 2,
      "via": [
        "e1cfbf2707bd4637d090c225"
      ],
      "onYourClasses": true
    },
    {
      "id": "585852683d4f8bf942941860",
      "name": "Functions",
      "nameHtml": "Functions",
      "chapter": {
        "id": "c73583630a99de2b156a97ac",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 3,
      "via": [
        "6a6dce1e67338c30a717f72b"
      ],
      "onYourClasses": true
    },
    {
      "id": "c341e2e66c7dd20fdca4ff30",
      "name": "Loops",
      "nameHtml": "Loops",
      "chapter": {
        "id": "500c0d5bbf1c8d8dfaf1bf27",
        "title": "Programming basics (last semester)",
        "titleHtml": "Programming basics (last semester)"
      },
      "depth": 4,
      "via": [
        "585852683d4f8bf942941860"
      ],
      "onYourClasses": false
    }
  ],
  "leadsTo": [
    {
      "id": "f4217273ff04b587e08388fb",
      "name": "Memoisation",
      "nameHtml": "Memoisation",
      "chapter": {
        "id": "c73583630a99de2b156a97ac",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 1,
      "via": [
        "1fab8e1ac1e302ba0d234198"
      ],
      "onYourClasses": true
    }
  ],
  "note": "Prerequisites are the topics your professor confirmed are needed first, nearest first."
};

/** GET /api/hub/topics/:id as asha (Functions): its one prerequisite is earlier material. */
export const READY_TOPIC_EARLIER = {
  "topic": {
    "id": "585852683d4f8bf942941860",
    "name": "Functions",
    "nameHtml": "Functions",
    "chapter": {
      "id": "c73583630a99de2b156a97ac",
      "title": "Recursion and the call stack",
      "titleHtml": "Recursion and the call stack"
    }
  },
  "prerequisites": [
    {
      "id": "c341e2e66c7dd20fdca4ff30",
      "name": "Loops",
      "nameHtml": "Loops",
      "chapter": {
        "id": "500c0d5bbf1c8d8dfaf1bf27",
        "title": "Programming basics (last semester)",
        "titleHtml": "Programming basics (last semester)"
      },
      "depth": 1,
      "via": [
        "585852683d4f8bf942941860"
      ],
      "onYourClasses": false
    }
  ],
  "leadsTo": [
    {
      "id": "6a6dce1e67338c30a717f72b",
      "name": "The call stack",
      "nameHtml": "The call stack",
      "chapter": {
        "id": "c73583630a99de2b156a97ac",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 1,
      "via": [
        "585852683d4f8bf942941860"
      ],
      "onYourClasses": true
    },
    {
      "id": "e1cfbf2707bd4637d090c225",
      "name": "Recursion",
      "nameHtml": "Recursion",
      "chapter": {
        "id": "c73583630a99de2b156a97ac",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 2,
      "via": [
        "6a6dce1e67338c30a717f72b"
      ],
      "onYourClasses": true
    },
    {
      "id": "1fab8e1ac1e302ba0d234198",
      "name": "Recursion trees",
      "nameHtml": "Recursion trees",
      "chapter": {
        "id": "c73583630a99de2b156a97ac",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 3,
      "via": [
        "e1cfbf2707bd4637d090c225"
      ],
      "onYourClasses": true
    },
    {
      "id": "f97df76c93f836a0e685c078",
      "name": "Traversals",
      "nameHtml": "Traversals",
      "chapter": {
        "id": "d3e4fc12861b23decb44e6cf",
        "title": "Trees",
        "titleHtml": "Trees"
      },
      "depth": 3,
      "via": [
        "e1cfbf2707bd4637d090c225"
      ],
      "onYourClasses": true
    },
    {
      "id": "f4217273ff04b587e08388fb",
      "name": "Memoisation",
      "nameHtml": "Memoisation",
      "chapter": {
        "id": "c73583630a99de2b156a97ac",
        "title": "Recursion and the call stack",
        "titleHtml": "Recursion and the call stack"
      },
      "depth": 4,
      "via": [
        "1fab8e1ac1e302ba0d234198"
      ],
      "onYourClasses": true
    }
  ],
  "note": "Prerequisites are the topics your professor confirmed are needed first, nearest first."
};

/** GET /api/hub/topics/:id as bilal (Binary trees): no prerequisites. */
export const READY_TOPIC_NONE = {
  "topic": {
    "id": "77fdf54bcbec4b90d300e9c2",
    "name": "Binary trees",
    "nameHtml": "Binary trees",
    "chapter": {
      "id": "e109e59b67d5ff63badef3ce",
      "title": "Trees",
      "titleHtml": "Trees"
    }
  },
  "prerequisites": [],
  "leadsTo": [
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
        "77fdf54bcbec4b90d300e9c2"
      ],
      "onYourClasses": true
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
      "depth": 1,
      "via": [
        "77fdf54bcbec4b90d300e9c2"
      ],
      "onYourClasses": true
    }
  ],
  "note": "Prerequisites are the topics your professor confirmed are needed first, nearest first."
};

/** GET /api/hub/getready/:id as asha: open, asking a match question. */
export const READY_OPEN = {
  "check": {
    "id": "4d86822e00aee08455f53086",
    "clientRunId": "asha-check-bst-00001",
    "startedAt": "2026-11-18T12:30:00.015Z",
    "endedAt": null,
    "status": "open",
    "asked": 1,
    "maxQuestions": 12,
    "rule": "The check asks at most 12 questions, about the topics this one needs first, nearest first. Two right answers in a row on a topic make it Ready and two wrong make it Needs review; after one of each, a third question decides (two of three right is Ready). A topic you have already mastered in practice is Ready without asking. A topic the check could not decide is Not sure yet."
  },
  "target": {
    "id": "8e69d8f249667056eb6dfb0c",
    "name": "Binary search trees",
    "nameHtml": "Binary search trees",
    "chapter": {
      "id": "d3e4fc12861b23decb44e6cf",
      "title": "Trees",
      "titleHtml": "Trees"
    }
  },
  "prerequisites": [
    {
      "topic": {
        "id": "2a453abf607315a2e19c9fe0",
        "name": "Binary trees",
        "nameHtml": "Binary trees",
        "chapter": {
          "id": "d3e4fc12861b23decb44e6cf",
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
      "_id": "a2213bf8a61e6b7ddd8292e7",
      "text": "Using $2^{h+1} - 1$, at most how many nodes can a binary tree of height $h = 2$ have?",
      "bloom": "apply",
      "topic": "Binary trees",
      "kind": "numeric",
      "source": "teacher",
      "unit": "",
      "provenance": {
        "by": "professor",
        "checked": true,
        "text": "Written by your professor."
      },
      "rich": {
        "text": "Using <math><mrow><msup><mn>2</mn><mrow><mi>h</mi><mo>+</mo><mn>1</mn></mrow></msup><mo>−</mo><mn>1</mn></mrow></math>, at most how many nodes can a binary tree of height <math><mrow><mi>h</mi><mo>=</mo><mn>2</mn></mrow></math> have?"
      }
    },
    "language": "en",
    "translationId": null,
    "languageNote": null,
    "topic": {
      "id": "2a453abf607315a2e19c9fe0",
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

/** GET /api/hub/getready/:id as bilal: asking a question with a code block. */
export const READY_ASKING_CODE = {
  "check": {
    "id": "37a488320cb628bb7d6ef9a2",
    "clientRunId": "hs4-sample-check-01",
    "startedAt": "2026-11-19T14:54:01.825Z",
    "endedAt": null,
    "status": "open",
    "asked": 1,
    "maxQuestions": 12,
    "rule": "The check asks at most 12 questions, about the topics this one needs first, nearest first. Two right answers in a row on a topic make it Ready and two wrong make it Needs review; after one of each, a third question decides (two of three right is Ready). A topic you have already mastered in practice is Ready without asking. A topic the check could not decide is Not sure yet."
  },
  "target": {
    "id": "66b0482a223f23d746733183",
    "name": "Traversals",
    "nameHtml": "Traversals",
    "chapter": {
      "id": "e109e59b67d5ff63badef3ce",
      "title": "Trees",
      "titleHtml": "Trees"
    }
  },
  "prerequisites": [
    {
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
      "depth": 1,
      "status": "asking",
      "outcome": null,
      "label": null,
      "answers": 1,
      "right": 0,
      "source": "check",
      "provisional": true,
      "sentence": "Being checked now: you got 0 of 1 right so far."
    },
    {
      "topic": {
        "id": "77fdf54bcbec4b90d300e9c2",
        "name": "Binary trees",
        "nameHtml": "Binary trees",
        "chapter": {
          "id": "e109e59b67d5ff63badef3ce",
          "title": "Trees",
          "titleHtml": "Trees"
        }
      },
      "depth": 1,
      "status": "waiting",
      "outcome": null,
      "label": null,
      "answers": 0,
      "right": 0,
      "source": "none",
      "provisional": true,
      "sentence": "Still to check."
    },
    {
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
      "depth": 2,
      "status": "waiting",
      "outcome": null,
      "label": null,
      "answers": 0,
      "right": 0,
      "source": "none",
      "provisional": true,
      "sentence": "Still to check."
    },
    {
      "topic": {
        "id": "12bc867a4943ed7e68d6d225",
        "name": "Base case",
        "nameHtml": "Base case",
        "chapter": {
          "id": "a42f9dfa54c87d20bf72261b",
          "title": "Recursion and the call stack",
          "titleHtml": "Recursion and the call stack"
        }
      },
      "depth": 2,
      "status": "waiting",
      "outcome": null,
      "label": null,
      "answers": 0,
      "right": 0,
      "source": "none",
      "provisional": true,
      "sentence": "Still to check."
    },
    {
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
      "depth": 3,
      "status": "waiting",
      "outcome": null,
      "label": null,
      "answers": 0,
      "right": 0,
      "source": "none",
      "provisional": true,
      "sentence": "Still to check."
    },
    {
      "topic": {
        "id": "c7ded5d61c8a8a68489adce9",
        "name": "Loops",
        "nameHtml": "Loops",
        "chapter": {
          "id": "f491be5f460d5b853be26618",
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
  "sentence": "Checking the topics \"Traversals\" needs first: 1 question asked of at most 12.",
  "question": {
    "question": {
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
      "id": "721870b77c4b6229593c997d",
      "name": "Recursion",
      "nameHtml": "Recursion"
    },
    "why": "Checking \"Recursion\", which \"Traversals\" needs first.",
    "hints": {
      "available": 0,
      "note": "No hints in a Get Ready check: it finds out what you already know."
    }
  }
};

/** POST /api/hub/getready/:id/answers as bilal, to READY_ASKING_CODE: not right, with the professor explanation. */
export const READY_ANSWER_WRONG = {
  "attempt": {
    "id": "2338d10b28c83b9932df784f",
    "attemptId": "hs4-sample-ans-02",
    "mode": "getready",
    "createdAt": "2026-11-19T14:54:40.618Z",
    "language": "en",
    "hintsUsed": 0
  },
  "duplicate": false,
  "correct": false,
  "score": 0,
  "detail": "",
  "solution": 0,
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
  },
  "optionFeedback": [],
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
      "state": "in-progress",
      "label": "In progress",
      "answers": 6,
      "attempts": 6,
      "provisional": false,
      "pRight": 0.47,
      "outOf10": 4,
      "estimateState": "in-progress",
      "sentence": "In progress: from your 6 answers, you would likely get about 4 in 10 typical questions on this topic right. Mastered means about 8 in 10, from at least 5 answers.",
      "review": {
        "dueAt": "2026-11-19T15:00:10.618Z",
        "due": false,
        "when": "in 6 minutes",
        "sessions": 1,
        "lastRating": "hard"
      }
    }
  },
  "check": {
    "check": {
      "id": "37a488320cb628bb7d6ef9a2",
      "clientRunId": "hs4-sample-check-01",
      "startedAt": "2026-11-19T14:54:01.825Z",
      "endedAt": null,
      "status": "open",
      "asked": 2,
      "maxQuestions": 12,
      "rule": "The check asks at most 12 questions, about the topics this one needs first, nearest first. Two right answers in a row on a topic make it Ready and two wrong make it Needs review; after one of each, a third question decides (two of three right is Ready). A topic you have already mastered in practice is Ready without asking. A topic the check could not decide is Not sure yet."
    },
    "target": {
      "id": "66b0482a223f23d746733183",
      "name": "Traversals",
      "nameHtml": "Traversals",
      "chapter": {
        "id": "e109e59b67d5ff63badef3ce",
        "title": "Trees",
        "titleHtml": "Trees"
      }
    },
    "prerequisites": [
      {
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
          "id": "77fdf54bcbec4b90d300e9c2",
          "name": "Binary trees",
          "nameHtml": "Binary trees",
          "chapter": {
            "id": "e109e59b67d5ff63badef3ce",
            "title": "Trees",
            "titleHtml": "Trees"
          }
        },
        "depth": 1,
        "status": "asking",
        "outcome": null,
        "label": null,
        "answers": 0,
        "right": 0,
        "source": "none",
        "provisional": true,
        "sentence": "Being checked now."
      },
      {
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
        "depth": 2,
        "status": "waiting",
        "outcome": null,
        "label": null,
        "answers": 0,
        "right": 0,
        "source": "none",
        "provisional": true,
        "sentence": "Still to check."
      },
      {
        "topic": {
          "id": "12bc867a4943ed7e68d6d225",
          "name": "Base case",
          "nameHtml": "Base case",
          "chapter": {
            "id": "a42f9dfa54c87d20bf72261b",
            "title": "Recursion and the call stack",
            "titleHtml": "Recursion and the call stack"
          }
        },
        "depth": 2,
        "status": "waiting",
        "outcome": null,
        "label": null,
        "answers": 0,
        "right": 0,
        "source": "none",
        "provisional": true,
        "sentence": "Still to check."
      },
      {
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
        "depth": 3,
        "status": "waiting",
        "outcome": null,
        "label": null,
        "answers": 0,
        "right": 0,
        "source": "none",
        "provisional": true,
        "sentence": "Still to check."
      },
      {
        "topic": {
          "id": "c7ded5d61c8a8a68489adce9",
          "name": "Loops",
          "nameHtml": "Loops",
          "chapter": {
            "id": "f491be5f460d5b853be26618",
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
    "sentence": "Checking the topics \"Traversals\" needs first: 2 questions asked of at most 12.",
    "question": {
      "question": {
        "_id": "a2c12919c5992a9f8dbfde99",
        "text": "At most how many children can a node of a binary tree have?",
        "bloom": "remember",
        "topic": "Binary trees",
        "kind": "mcq",
        "source": "teacher",
        "options": [
          "2",
          "1",
          "3",
          "Any number"
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
        "id": "77fdf54bcbec4b90d300e9c2",
        "name": "Binary trees",
        "nameHtml": "Binary trees"
      },
      "why": "Checking \"Binary trees\", which \"Traversals\" needs first.",
      "hints": {
        "available": 0,
        "note": "No hints in a Get Ready check: it finds out what you already know."
      }
    }
  }
};

/** GET /api/hub/getready/:id as asha: complete, with the refresher path. */
export const READY_COMPLETE = {
  "check": {
    "id": "417d828f426c8841789e1cc7",
    "clientRunId": "asha-check-recursion-trees",
    "startedAt": "2026-11-16T12:30:00.017Z",
    "endedAt": "2026-11-16T12:30:00.409Z",
    "status": "complete",
    "asked": 9,
    "maxQuestions": 12,
    "rule": "The check asks at most 12 questions, about the topics this one needs first, nearest first. Two right answers in a row on a topic make it Ready and two wrong make it Needs review; after one of each, a third question decides (two of three right is Ready). A topic you have already mastered in practice is Ready without asking. A topic the check could not decide is Not sure yet."
  },
  "target": {
    "id": "1fab8e1ac1e302ba0d234198",
    "name": "Recursion trees",
    "nameHtml": "Recursion trees",
    "chapter": {
      "id": "c73583630a99de2b156a97ac",
      "title": "Recursion and the call stack",
      "titleHtml": "Recursion and the call stack"
    }
  },
  "prerequisites": [
    {
      "topic": {
        "id": "e1cfbf2707bd4637d090c225",
        "name": "Recursion",
        "nameHtml": "Recursion",
        "chapter": {
          "id": "c73583630a99de2b156a97ac",
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
        "id": "6a6dce1e67338c30a717f72b",
        "name": "The call stack",
        "nameHtml": "The call stack",
        "chapter": {
          "id": "c73583630a99de2b156a97ac",
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
        "id": "a2b219de965b391e364a5ddf",
        "name": "Base case",
        "nameHtml": "Base case",
        "chapter": {
          "id": "c73583630a99de2b156a97ac",
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
        "id": "585852683d4f8bf942941860",
        "name": "Functions",
        "nameHtml": "Functions",
        "chapter": {
          "id": "c73583630a99de2b156a97ac",
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
        "id": "c341e2e66c7dd20fdca4ff30",
        "name": "Loops",
        "nameHtml": "Loops",
        "chapter": {
          "id": "500c0d5bbf1c8d8dfaf1bf27",
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
    "steps": [
      {
        "topicId": "e1cfbf2707bd4637d090c225",
        "name": "Recursion",
        "depth": 1,
        "why": "On your path because you got 0 of 2 right on it in the Get Ready check. \"Recursion trees\" builds on it directly.",
        "status": "in-progress",
        "answers": 2,
        "right": 1,
        "sentence": "Since the check: 1 of 2 answers right. A step is done when your answers on it since the check are two right in a row, or two right of your last three. A question you answer again counts once you have answered every other question on the topic since.",
        "topic": {
          "id": "e1cfbf2707bd4637d090c225",
          "name": "Recursion",
          "nameHtml": "Recursion"
        }
      }
    ],
    "target": {
      "topicId": "1fab8e1ac1e302ba0d234198",
      "name": "Recursion trees",
      "status": "waiting",
      "sentence": "The goal: start \"Recursion trees\" once the steps above are done.",
      "topic": {
        "id": "1fab8e1ac1e302ba0d234198",
        "name": "Recursion trees",
        "nameHtml": "Recursion trees"
      }
    },
    "next": "e1cfbf2707bd4637d090c225",
    "done": 0,
    "total": 1,
    "rule": "A step is done when your answers on it since the check are two right in a row, or two right of your last three. A question you answer again counts once you have answered every other question on the topic since."
  }
};

/** GET /api/hub/getready/:id as bilal: complete, with an earlier-material topic. */
export const READY_COMPLETE_B = {
  "check": {
    "id": "e29cdb9907f19acc3f2acaf3",
    "clientRunId": "89b94b8e-a330-498b-bbe2-4d43ee5b5c24",
    "startedAt": "2026-11-19T14:50:34.959Z",
    "endedAt": "2026-11-19T14:52:14.015Z",
    "status": "complete",
    "asked": 8,
    "maxQuestions": 12,
    "rule": "The check asks at most 12 questions, about the topics this one needs first, nearest first. Two right answers in a row on a topic make it Ready and two wrong make it Needs review; after one of each, a third question decides (two of three right is Ready). A topic you have already mastered in practice is Ready without asking. A topic the check could not decide is Not sure yet."
  },
  "target": {
    "id": "ec9414d6221be5eab7331746",
    "name": "Recursion trees",
    "nameHtml": "Recursion trees",
    "chapter": {
      "id": "a42f9dfa54c87d20bf72261b",
      "title": "Recursion and the call stack",
      "titleHtml": "Recursion and the call stack"
    }
  },
  "prerequisites": [
    {
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
      "depth": 1,
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
        "id": "e512651f20354a8945385751",
        "name": "The call stack",
        "nameHtml": "The call stack",
        "chapter": {
          "id": "a42f9dfa54c87d20bf72261b",
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
        "id": "12bc867a4943ed7e68d6d225",
        "name": "Base case",
        "nameHtml": "Base case",
        "chapter": {
          "id": "a42f9dfa54c87d20bf72261b",
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
        "id": "26661816288ea315652efaba",
        "name": "Functions",
        "nameHtml": "Functions",
        "chapter": {
          "id": "a42f9dfa54c87d20bf72261b",
          "title": "Recursion and the call stack",
          "titleHtml": "Recursion and the call stack"
        }
      },
      "depth": 3,
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
        "id": "c7ded5d61c8a8a68489adce9",
        "name": "Loops",
        "nameHtml": "Loops",
        "chapter": {
          "id": "f491be5f460d5b853be26618",
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
    "steps": [
      {
        "topicId": "26661816288ea315652efaba",
        "name": "Functions",
        "depth": 3,
        "why": "On your path because you got 0 of 2 right on it in the Get Ready check. It comes before \"The call stack\", on the way to \"Recursion trees\".",
        "status": "to-do",
        "answers": 0,
        "right": 0,
        "sentence": "Not practised since the check. A step is done when your answers on it since the check are two right in a row, or two right of your last three. A question you answer again counts once you have answered every other question on the topic since.",
        "topic": {
          "id": "26661816288ea315652efaba",
          "name": "Functions",
          "nameHtml": "Functions"
        }
      }
    ],
    "target": {
      "topicId": "ec9414d6221be5eab7331746",
      "name": "Recursion trees",
      "status": "waiting",
      "sentence": "The goal: start \"Recursion trees\" once the steps above are done.",
      "topic": {
        "id": "ec9414d6221be5eab7331746",
        "name": "Recursion trees",
        "nameHtml": "Recursion trees"
      }
    },
    "next": "26661816288ea315652efaba",
    "done": 0,
    "total": 1,
    "rule": "A step is done when your answers on it since the check are two right in a row, or two right of your last three. A question you answer again counts once you have answered every other question on the topic since."
  }
};

/** Any hub call with no sign-in. */
export const E401 = {
  "status": 401,
  "message": "Sign in to continue."
};

/** A student route called by a professor. */
export const E403 = {
  "status": 403,
  "message": "This is for a student account. Staff see their students' progress through the class."
};

/** A self-test that is not this student's (or no longer exists). */
export const E404 = {
  "status": 404,
  "message": "That self-test was not found."
};

/** Every hub route on a server with no accounts (docs/API.md, Phase 6). */
export const E503 = {
  "status": 503,
  "message": "The learning hub needs student and staff accounts, and this server has none set up."
};
