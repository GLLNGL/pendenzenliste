import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api.js';
import PendenzModal from '../components/PendenzModal.jsx';
import { useMandanten, useMitarbeitende } from '../hooks.js';
import { formatiereZeitstempel, heutigesDatumISO } from '../format.js';
import { aufAenderungHoeren, meldeAenderung } from '../events.js';

// Sammelbecken fuer noch nicht eingeplante Notizen -- sowohl unterwegs erfasst (siehe
// MobilErfassen.jsx) als auch direkt hier am PC (Schnellerfassung unten, gleiches Prinzip:
// geplant:false). Diese Pendenzen tauchen bewusst noch NICHT in Cockpit/Alle Pendenzen/
// Mandanten auf, bis sie hier geoeffnet und im vollen Formular gespeichert (= eingeplant)
// wurden.
function Schnellerfassung({ onErfasst }) {
  const [titel, setTitel] = useState('');
  const [bemerkung, setBemerkung] = useState('');
  const [speichertGerade, setSpeichertGerade] = useState(false);
  const [fehler, setFehler] = useState(null);
  const titelRef = useRef(null);

  async function speichern(e) {
    e.preventDefault();
    if (!titel.trim()) return;
    setSpeichertGerade(true);
    setFehler(null);
    try {
      await api.pendenzen.erstellen({
        titel: titel.trim(),
        beschreibung: bemerkung.trim() || null,
        faelligkeit: heutigesDatumISO(),
        prioritaet: 'B',
        status: 'Offen',
        geplant: false,
      });
      meldeAenderung();
      setTitel('');
      setBemerkung('');
      titelRef.current?.focus();
      onErfasst();
    } catch (err) {
      setFehler(err.message);
    } finally {
      setSpeichertGerade(false);
    }
  }

  return (
    <form className="eingang-schnellerfassung" onSubmit={speichern}>
      <input
        ref={titelRef}
        type="text"
        value={titel}
        onChange={(e) => setTitel(e.target.value)}
        placeholder="Neue Notiz -- Titel…"
      />
      <textarea
        value={bemerkung}
        onChange={(e) => setBemerkung(e.target.value)}
        placeholder="Bemerkung (optional)…"
        rows={2}
      />
      {fehler && <div className="hinweis-fehler">{fehler}</div>}
      <button type="submit" className="btn btn-primary" disabled={!titel.trim() || speichertGerade}>
        {speichertGerade ? 'Speichert…' : '+ Erfassen'}
      </button>
    </form>
  );
}

// Triage fuer jeden Eingang (Arbeitsprozess): Aktion noetig? -> unter 2 Minuten? -> wartet auf
// Dritte? -> mehrere Schritte? -> sonst als Pendenz einplanen. Die Knoepfe stehen in genau
// dieser Reihenfolge. "Keine Aktion" und "Sofort erledigt" legen die Notiz als erledigt ab (mit
// begruendender Fortschrittsnotiz, nichts wird geloescht); die anderen oeffnen das
// Bearbeiten-Fenster passend vorbereitet.
function TriageKnoepfe({ eintrag, onAblegen, onOeffnen }) {
  function klick(ev, aktion) {
    ev.stopPropagation();
    aktion();
  }
  return (
    <div className="triage-knoepfe">
      <button type="button" className="btn-klein" title="Keine Aktion nötig – als erledigt ablegen" onClick={(ev) => klick(ev, () => onAblegen(eintrag, 'keine'))}>
        Keine Aktion
      </button>
      <button type="button" className="btn-klein" title="In unter 2 Minuten erledigt – gleich jetzt machen und abhaken" onClick={(ev) => klick(ev, () => onAblegen(eintrag, 'sofort'))}>
        ✓ Sofort erledigt (&lt; 2 Min.)
      </button>
      <button type="button" className="btn-klein" title="Wartet auf Dritte – Person und Nachfassdatum erfassen" onClick={(ev) => klick(ev, () => onOeffnen({ ...eintrag, status: 'Warten auf' }, false))}>
        Warten auf …
      </button>
      <button type="button" className="btn-klein" title="Mehrere Schritte – als Projekt mit Schritten einplanen" onClick={(ev) => klick(ev, () => onOeffnen(eintrag, true))}>
        Projekt …
      </button>
      <button type="button" className="btn-klein btn-klein-primaer" title="Als Pendenz einplanen (Mandant, Frist, Aufwand, Priorität)" onClick={(ev) => klick(ev, () => onOeffnen(eintrag, false))}>
        Einplanen →
      </button>
    </div>
  );
}

export default function Eingang() {
  const [eintraege, setEintraege] = useState([]);
  const [fehler, setFehler] = useState(null);
  const [aktion, setAktion] = useState(null); // { pendenz, projektModus }
  const mandanten = useMandanten();
  const mitarbeitende = useMitarbeitende();

  const laden = useCallback(() => {
    api.pendenzen.eingang().then(setEintraege).catch((e) => setFehler(e.message));
  }, []);

  useEffect(() => {
    laden();
    return aufAenderungHoeren(laden);
  }, [laden]);

  async function ablegen(eintrag, art) {
    try {
      await api.pendenzen.triageAblegen(eintrag.id, art);
      meldeAenderung();
      laden();
    } catch (err) {
      setFehler(err.message);
    }
  }

  function oeffnen(pendenz, projektModus) {
    setAktion({ pendenz, projektModus });
  }

  if (fehler) return <div className="fehleranzeige">Fehler: {fehler}</div>;

  return (
    <div>
      <h1 className="seiten-titel">
        Eingang
        {eintraege.length > 0 && <span className="zaehler-pille seiten-titel-pille">{eintraege.length}</span>}
      </h1>
      <p className="seiten-untertitel">
        Triage für jeden Eintrag: Aktion nötig? → unter 2 Minuten? → wartet auf Dritte? → mehrere Schritte? → sonst einplanen.
      </p>

      <div className="karte">
        <Schnellerfassung onErfasst={laden} />
        {eintraege.length === 0 && <div className="leer-hinweis" style={{ padding: 24 }}>Eingang ist leer.</div>}
        {eintraege.map((e) => (
          <div
            key={e.id}
            className="eingang-eintrag"
            role="button"
            tabIndex={0}
            onClick={() => oeffnen(e, false)}
            onKeyDown={(ev) => { if (ev.key === 'Enter') oeffnen(e, false); }}
          >
            <div className="eingang-eintrag-kopf">
              <span className="eingang-eintrag-titel">{e.titel}</span>
              <span className="eingang-eintrag-datum">{formatiereZeitstempel(e.erstellt_am)}</span>
            </div>
            {e.beschreibung && <p className="eingang-eintrag-text">{e.beschreibung}</p>}
            <TriageKnoepfe eintrag={e} onAblegen={ablegen} onOeffnen={oeffnen} />
          </div>
        ))}
      </div>

      {aktion && (
        <PendenzModal
          key={aktion.pendenz.id}
          pendenz={aktion.pendenz}
          projektModus={aktion.projektModus}
          mandanten={mandanten}
          mitarbeitende={mitarbeitende}
          onSchliessen={() => setAktion(null)}
          onGespeichert={() => { setAktion(null); laden(); }}
          onGeloescht={() => { setAktion(null); laden(); }}
        />
      )}
    </div>
  );
}
