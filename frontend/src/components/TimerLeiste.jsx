import { useState } from 'react';
import ZeitModal from './ZeitModal.jsx';
import { laufendeMinuten, formatiereDauer, uhrzeitAus } from '../lib/zeit.js';
import { useLaufenderTimer } from '../lib/timer.js';

// Anzeige in der Seitenleiste: laeuft ein Timer, sieht man ihn auf jeder Seite und kann ihn
// dort stoppen.
export default function TimerLeiste() {
  const timer = useLaufenderTimer();
  const [stoppen, setStoppen] = useState(false);
  if (!timer) return null;
  const titel = timer.pendenzen?.titel || timer.beschreibung || 'Ohne Pendenz';
  return (
    <>
      <div className="timer-leiste" title={`${titel}${timer.mandanten?.name ? ` · ${timer.mandanten.name}` : ''}`}>
        <span className="timer-punkt" aria-hidden="true" />
        <span className="timer-text">
          <span className="timer-dauer">{formatiereDauer(laufendeMinuten(timer.timer_start))} <span className="timer-seit">seit {uhrzeitAus(timer.timer_start)}</span></span>
          <span className="timer-titel">{titel}</span>
        </span>
        <button type="button" className="btn-klein timer-stopp" onClick={() => setStoppen(true)}>■ Stopp</button>
      </div>
      {stoppen && <ZeitModal eintrag={timer} onSchliessen={() => setStoppen(false)} onGespeichert={() => setStoppen(false)} />}
    </>
  );
}

