import { useCallback, useEffect, useState } from 'react';
import api from '../api.js';
import ZeitModal from './ZeitModal.jsx';
import { aufZeitAenderungHoeren, meldeZeitAenderung } from '../events.js';
import { laufendeMinuten, formatiereDauer, leistungVorschlag, artVorschlag } from '../lib/zeit.js';
import { aktivePauschalen } from '../lib/preise.js';
import { heutigesDatumISO } from '../format.js';

// Laufender Timer der angemeldeten Person (null = keiner). Aktualisiert sich bei jeder
// Zeit-Aenderung in der App und zaehlt die angezeigte Dauer jede halbe Minute weiter.
function useLaufenderTimer() {
  const [timer, setTimer] = useState(null);
  const [, setTakt] = useState(0);
  const laden = useCallback(() => { api.zeit.laufender().then(setTimer).catch(() => setTimer(null)); }, []);
  useEffect(() => {
    laden();
    return aufZeitAenderungHoeren(laden);
  }, [laden]);
  useEffect(() => {
    if (!timer) return undefined;
    const id = setInterval(() => setTakt((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, [timer]);
  return timer;
}

// Timer starten fuer eine Pendenz -- Mandant, Leistung und Art werden vorgeschlagen.
async function timerStarten(pendenz) {
  const pauschalen = pendenz.mandant_id ? await api.pauschalen.liste(pendenz.mandant_id) : [];
  const aktiv = aktivePauschalen(pauschalen, heutigesDatumISO());
  const leistungId = leistungVorschlag(pendenz, aktiv);
  const ergebnis = await api.zeit.starten({
    pendenzId: pendenz.id, mandantId: pendenz.mandant_id, leistungId,
    art: artVorschlag(pendenz.mandant_id, leistungId, aktiv), beschreibung: pendenz.titel,
  });
  meldeZeitAenderung();
  return ergebnis;
}

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
          <span className="timer-dauer">{formatiereDauer(laufendeMinuten(timer.timer_start))}</span>
          <span className="timer-titel">{titel}</span>
        </span>
        <button type="button" className="btn-klein timer-stopp" onClick={() => setStoppen(true)}>■ Stopp</button>
      </div>
      {stoppen && <ZeitModal eintrag={timer} onSchliessen={() => setStoppen(false)} onGespeichert={() => setStoppen(false)} />}
    </>
  );
}

export { useLaufenderTimer, timerStarten };
