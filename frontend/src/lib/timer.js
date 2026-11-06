import { useCallback, useEffect, useState } from 'react';
import api from '../api.js';
import { aufZeitAenderungHoeren, meldeZeitAenderung } from '../events.js';
import { leistungVorschlag, artVorschlag } from './zeit.js';
import { aktivePauschalen } from './preise.js';
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
    art: pendenz.verrechnung && pendenz.mandant_id ? pendenz.verrechnung : artVorschlag(pendenz.mandant_id, leistungId, aktiv),
    beschreibung: pendenz.titel,
  });
  meldeZeitAenderung();
  return ergebnis;
}

export { useLaufenderTimer, timerStarten };
