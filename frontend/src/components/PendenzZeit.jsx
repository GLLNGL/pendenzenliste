import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../api.js';
import ZeitModal from './ZeitModal.jsx';
import { useLaufenderTimer, timerStarten } from '../lib/timer.js';
import { aufZeitAenderungHoeren } from '../events.js';
import { formatiereDatum } from '../format.js';
import { formatiereDauer, formatiereStundenSumme, artLabel, laufendeMinuten, zusammenfassung, uhrzeitAus, uhrzeitPlus } from '../lib/zeit.js';

// Abschnitt "Zeit" in der Detailansicht einer Pendenz: erfasste Zeit, Timer Start/Stopp,
// Zeit von Hand erfassen; Klick auf einen Eintrag korrigiert ihn.
export default function PendenzZeit({ pendenz, kompakt = false }) {
  const [eintraege, setEintraege] = useState([]);
  const [offen, setOffen] = useState(null); // { eintrag } | { neu: true }
  const [fehler, setFehler] = useState(null);
  const timer = useLaufenderTimer();

  const laden = useCallback(() => {
    api.zeit.liste({ pendenzId: pendenz.id }).then(setEintraege).catch(() => setEintraege([]));
  }, [pendenz.id]);
  useEffect(() => {
    laden();
    return aufZeitAenderungHoeren(laden);
  }, [laden]);

  const laeuftHier = timer && timer.pendenz_id === pendenz.id;
  const summe = zusammenfassung(eintraege);

  async function starten() {
    setFehler(null);
    try {
      await timerStarten(pendenz);
    } catch (e) {
      setFehler(e.message);
    }
  }

  return (
    <div className={`pendenz-vorschau-fortschritt pendenz-zeit ${kompakt ? 'pendenz-zeit-kompakt' : ''}`} onClick={(e) => e.stopPropagation()}>
      <div className="pendenz-vorschau-teilaufgaben-titel">
        Zeit
        {summe.gesamt > 0 && (
          <span className="teilaufgaben-zaehler">
            {formatiereStundenSumme(summe.gesamt)}
            {summe.extra > 0 && ` · davon Extra ${formatiereStundenSumme(summe.extra)}`}
          </span>
        )}
      </div>
      <div className="pendenz-zeit-knoepfe">
        {laeuftHier ? (
          <button type="button" className="btn-klein btn-klein-primaer" onClick={() => setOffen({ eintrag: timer })}>
            ■ Stopp · läuft seit {uhrzeitAus(timer.timer_start)} ({formatiereDauer(laufendeMinuten(timer.timer_start))})
          </button>
        ) : (
          <button type="button" className="btn-klein" onClick={starten} title={timer ? 'Der laufende Timer wird dabei gestoppt und gespeichert.' : undefined}>
            ▶ Timer starten
          </button>
        )}
        <button type="button" className="btn-klein" onClick={() => setOffen({ neu: true })}>+ Zeit erfassen</button>
      </div>
      {fehler && <div className="hinweis-fehler">{fehler}</div>}
      {eintraege.filter((e) => e.minuten != null).length === 0 ? (
        <p className="pendenz-vorschau-fortschritt-leer">Noch keine Zeit erfasst.</p>
      ) : (
        <div className="pendenz-zeit-liste">
          {eintraege.filter((e) => e.minuten != null).slice(0, 8).map((e) => (
            <button type="button" key={e.id} className="pendenz-zeit-zeile" onClick={() => setOffen({ eintrag: e })} title="Bearbeiten">
              <span>{formatiereDatum(e.datum)}{e.timer_start ? ` ${uhrzeitAus(e.timer_start)}–${uhrzeitPlus(uhrzeitAus(e.timer_start), e.minuten)}` : ''}</span>
              <span className="pendenz-zeit-person">{e.mitarbeitende?.name ?? ''}</span>
              <span className={`zeit-art zeit-art-${e.art}`}>{artLabel(e.art)}</span>
              <span className="pendenz-zeit-dauer">{formatiereDauer(e.minuten)}</span>
            </button>
          ))}
        </div>
      )}
      {offen && createPortal(
        <ZeitModal
          eintrag={offen.eintrag ?? null}
          pendenz={offen.neu ? pendenz : null}
          onSchliessen={() => setOffen(null)}
          onGespeichert={() => setOffen(null)}
        />,
        document.body,
      )}
    </div>
  );
}
