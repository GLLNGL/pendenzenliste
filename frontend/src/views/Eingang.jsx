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
        prioritaet: 'Mittel',
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

export default function Eingang() {
  const [eintraege, setEintraege] = useState([]);
  const [fehler, setFehler] = useState(null);
  const [aktivePendenz, setAktivePendenz] = useState(null);
  const mandanten = useMandanten();
  const mitarbeitende = useMitarbeitende();

  const laden = useCallback(() => {
    api.pendenzen.eingang().then(setEintraege).catch((e) => setFehler(e.message));
  }, []);

  useEffect(() => {
    laden();
    return aufAenderungHoeren(laden);
  }, [laden]);

  if (fehler) return <div className="fehleranzeige">Fehler beim Laden: {fehler}</div>;

  return (
    <div>
      <h1 className="seiten-titel">
        Eingang
        {eintraege.length > 0 && <span className="zaehler-pille seiten-titel-pille">{eintraege.length}</span>}
      </h1>
      <p className="seiten-untertitel">Noch nicht eingeplante Notizen -- hier öffnen, um sie einem Mandanten/einer Fälligkeit zuzuordnen. Danach erscheinen sie ganz normal in Cockpit und Alle Pendenzen.</p>

      <div className="karte">
        <Schnellerfassung onErfasst={laden} />
        {eintraege.length === 0 && <div className="leer-hinweis" style={{ padding: 24 }}>Eingang ist leer.</div>}
        {eintraege.map((e) => (
          <div
            key={e.id}
            className="eingang-eintrag"
            role="button"
            tabIndex={0}
            onClick={() => setAktivePendenz(e)}
            onKeyDown={(ev) => { if (ev.key === 'Enter') setAktivePendenz(e); }}
          >
            <div className="eingang-eintrag-kopf">
              <span className="eingang-eintrag-titel">{e.titel}</span>
              <span className="eingang-eintrag-datum">{formatiereZeitstempel(e.erstellt_am)}</span>
            </div>
            {e.beschreibung && <p className="eingang-eintrag-text">{e.beschreibung}</p>}
          </div>
        ))}
      </div>

      {aktivePendenz && (
        <PendenzModal
          key={aktivePendenz.id}
          pendenz={aktivePendenz}
          mandanten={mandanten}
          mitarbeitende={mitarbeitende}
          onSchliessen={() => setAktivePendenz(null)}
          onGespeichert={() => { setAktivePendenz(null); laden(); }}
          onGeloescht={() => { setAktivePendenz(null); laden(); }}
        />
      )}
    </div>
  );
}
