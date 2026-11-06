import { useCallback, useEffect, useState } from 'react';
import api from '../api.js';
import ZeitModal from './ZeitModal.jsx';
import MandantSuche from './MandantSuche.jsx';
import { useMandanten } from '../hooks.js';
import { useLaufenderTimer } from '../lib/timer.js';
import { aufZeitAenderungHoeren, meldeZeitAenderung } from '../events.js';
import { heutigesDatumISO } from '../format.js';
import { laufendeMinuten, formatiereDauer, formatiereStundenSumme, artLabel, artVorschlag, zusammenfassung } from '../lib/zeit.js';
import { aktivePauschalen } from '../lib/preise.js';

// Handy: Timer starten/stoppen und Zeit nachtragen -- unterwegs beim Mandanten.
export default function MobilZeit() {
  const timer = useLaufenderTimer();
  const mandanten = useMandanten();
  const [mandantId, setMandantId] = useState('');
  const [text, setText] = useState('');
  const [heute, setHeute] = useState([]);
  const [offen, setOffen] = useState(null);
  const [fehler, setFehler] = useState(null);

  const laden = useCallback(() => {
    api.mitarbeitende.aktuelleId().then((ich) => api.zeit.liste({ von: heutigesDatumISO(), bis: heutigesDatumISO(), mitarbeiterId: ich }))
      .then(setHeute).catch(() => setHeute([]));
  }, []);
  useEffect(() => {
    laden();
    return aufZeitAenderungHoeren(laden);
  }, [laden]);

  async function starten() {
    setFehler(null);
    try {
      const pauschalen = mandantId ? aktivePauschalen(await api.pauschalen.liste(Number(mandantId)), heutigesDatumISO()) : [];
      await api.zeit.starten({ mandantId: mandantId ? Number(mandantId) : null, art: artVorschlag(mandantId, null, pauschalen), beschreibung: text });
      setText('');
      meldeZeitAenderung();
    } catch (e) {
      setFehler(e.message);
    }
  }

  const s = zusammenfassung(heute);

  return (
    <div className="mobil-zeit">
      <h1 className="seiten-titel">Zeit</h1>
      {timer ? (
        <div className="mobil-timer">
          <div className="mobil-timer-dauer">{formatiereDauer(laufendeMinuten(timer.timer_start))}</div>
          <div className="mobil-timer-titel">{timer.pendenzen?.titel || timer.beschreibung || 'Ohne Text'}{timer.mandanten?.name ? ` · ${timer.mandanten.name}` : ''}</div>
          <button type="button" className="btn btn-primary mobil-gross" onClick={() => setOffen({ eintrag: timer })}>■ Stoppen</button>
        </div>
      ) : (
        <div className="mobil-timer-start">
          <div className="feld">
            <label htmlFor="mobil-zeit-mandant">Mandant</label>
            <div className="feld-inline">
              <MandantSuche id="mobil-zeit-mandant" mandanten={mandanten} wert={mandantId} onWahl={setMandantId} leerText="Intern (ohne Mandant)" />
              {mandantId && <button type="button" className="btn-klein" onClick={() => setMandantId('')}>×</button>}
            </div>
          </div>
          <div className="feld">
            <label htmlFor="mobil-zeit-text">Tätigkeit</label>
            <input id="mobil-zeit-text" type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="z.B. Besprechung Jahresabschluss" />
          </div>
          <button type="button" className="btn btn-primary mobil-gross" onClick={starten}>▶ Timer starten</button>
        </div>
      )}
      {fehler && <div className="hinweis-fehler">{fehler}</div>}
      <button type="button" className="btn mobil-gross" onClick={() => setOffen({ neu: true })}>+ Zeit nachtragen</button>

      <h2 className="abschnitt-titel">Heute · {formatiereStundenSumme(s.gesamt)}</h2>
      <div className="pendenz-zeit-liste">
        {heute.filter((e) => e.minuten != null).map((e) => (
          <button type="button" key={e.id} className="pendenz-zeit-zeile" onClick={() => setOffen({ eintrag: e })}>
            <span>{e.mandanten?.name ?? 'Intern'}</span>
            <span className="pendenz-zeit-person">{e.beschreibung || e.pendenzen?.titel || ''}</span>
            <span className={`zeit-art zeit-art-${e.art}`}>{artLabel(e.art)}</span>
            <span className="pendenz-zeit-dauer">{formatiereDauer(e.minuten)}</span>
          </button>
        ))}
        {heute.filter((e) => e.minuten != null).length === 0 && <p className="pendenz-vorschau-fortschritt-leer">Heute noch nichts erfasst.</p>}
      </div>

      {offen && <ZeitModal eintrag={offen.eintrag ?? null} onSchliessen={() => setOffen(null)} onGespeichert={() => setOffen(null)} />}
    </div>
  );
}
