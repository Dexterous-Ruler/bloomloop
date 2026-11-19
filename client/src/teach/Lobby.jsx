/**
 * The waiting room (Phase 3), at the top of the live view while a room opened
 * with `lobby: true` waits for its professor.
 *
 * Its figure is the grid's `waiting.summary`: phones joined, of the students
 * marked present ("9 / 12 present"), or "9 joined" in a room with no class.
 * That is not the attendance figure (`attendance.summary`, students present of
 * the whole class), so the two are never shown as one and this one says what it
 * counts.
 *
 * Start is POST /:code/start. The server decides whether it may (`canStart`,
 * with its `reason` when not): a Student-devices or Mixed room waits for one
 * phone, a Teacher-led room starts with none. Its 409s are shown as given.
 *
 * @param code        the room code
 * @param waiting     teacher:grid's `waiting`: { joinedN, present, classSize, summary, canStart, reason? }
 * @param canControl  from the room list row; false for a room this account may only read
 * @param mode        the room's settings.mode: devices | teacher-led | mixed
 * @param onStarted   (reply) => after the start answered { session, settings }
 * @param start       stands in for api.startSession (the dev gallery)
 */

import { useState } from 'react';

import { api } from '../lib/api.js';
import { Button, Icon, Note } from '../ui/index.jsx';

export default function Lobby({ code, waiting, canControl = false, mode = 'devices', onStarted, start = api.startSession }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(false);

  if (!waiting) {
    return (
      <section className="card lb" aria-busy="true" aria-label="Reading the waiting room">
        <div className="lb-main">
          <span className="skel lb-skel-a" />
          <span className="skel lb-skel-b" />
        </div>
        <span className="skel lb-skel-c" />
      </section>
    );
  }

  const teacherLed = mode === 'teacher-led';
  const inClass = waiting.present != null;
  const fill = inClass && waiting.present > 0 ? Math.min(1, waiting.joinedN / waiting.present) : null;

  async function go() {
    setBusy(true); setError('');
    try {
      const reply = await start(code);
      setStarted(true);
      onStarted?.(reply);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  let line;
  if (teacherLed) line = 'No phone joins a Teacher-led room, so you can start whenever you are ready.';
  else if (started) line = 'Started. Every phone that was waiting has been sent its first question.';
  else line = 'Phones that join wait here. Nothing is served until you start, and then every waiting phone gets its first question at once.';

  return (
    <section className="card lb" aria-label="Waiting room" data-started={started ? 'true' : undefined}>
      <div className="lb-main">
        <span className="eyebrow lb-eyebrow">
          {started ? <Icon name="ok" size={14} /> : <i className="live-dot" aria-hidden="true" />}
          {started ? 'Waiting room · started' : 'Waiting room · not started'}
        </span>

        {!teacherLed && (
          <div className="lb-fig">
            <b aria-live="polite">{waiting.summary}</b>
            <span>
              {inClass
                ? 'Phones joined, of the students marked present. Not the attendance figure, which counts the whole class.'
                : 'Phones waiting in the room. It has no class, so there is no present count.'}
            </span>
          </div>
        )}
        {fill != null && !teacherLed && (
          <span className="lb-meter" aria-hidden="true"><i style={{ width: `${fill * 100}%` }} /></span>
        )}
        <p className="lb-line" role={started ? 'status' : undefined}>{line}</p>
      </div>

      <div className="lb-act">
        {canControl ? (
          <>
            <Button
              variant="primary"
              size="lg"
              icon="play"
              busy={busy}
              disabled={!waiting.canStart || started}
              aria-describedby={!waiting.canStart && waiting.reason ? 'lb-why' : undefined}
              onClick={go}
            >
              Start the room
            </Button>
            {!waiting.canStart && waiting.reason && <p className="lb-why" id="lb-why">{waiting.reason}</p>}
          </>
        ) : (
          <p className="lb-ro"><Icon name="lock" size={14} />Read only. Only the professor who opened this room can start it.</p>
        )}
        <span className="lb-code">Room code <b className="mono">{code}</b></span>
      </div>

      {error && <Note tone="bad" role="alert" className="lb-err">{error}</Note>}
    </section>
  );
}
