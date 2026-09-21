import { useRef, useState } from 'react';
import api from '../api.js';
import { heutigesDatumISO } from '../format.js';
import { meldeAenderung } from '../events.js';

// Die einzige Aufgabe dieser Ansicht: unterwegs in Sekunden etwas aufnotieren. Nur Titel und
// Bemerkung -- Mandant, Prioritaet usw. lassen sich spaeter am Buero-PC in Ruhe nachtragen.
// Nach dem Speichern bleibt das Formular offen und leer, damit man direkt die naechste Pendenz
// erfassen kann.
export default function MobilErfassen() {
  const [titel, setTitel] = useState('');
  const [bemerkung, setBemerkung] = useState('');
  const [speichertGerade, setSpeichertGerade] = useState(false);
  const [fehler, setFehler] = useState(null);
  const [gespeichert, setGespeichert] = useState(false);
  const titelRef = useRef(null);

  async function speichern(e) {
    e.preventDefault();
    if (!titel.trim()) return;

    setSpeichertGerade(true);
    setFehler(null);
    setGespeichert(false);
    try {
      await api.pendenzen.erstellen({
        titel: titel.trim(),
        beschreibung: bemerkung.trim() || null,
        faelligkeit: heutigesDatumISO(),
        prioritaet: 'Mittel',
        status: 'Offen',
        // Landet im "Eingang" (Desktop-Ansicht) statt sofort in Cockpit/Alle Pendenzen --
        // wird dort einem Mandanten/einer echten Faelligkeit zugeordnet.
        geplant: false,
      });
      meldeAenderung();
      setTitel('');
      setBemerkung('');
      setGespeichert(true);
      titelRef.current?.focus();
    } catch (err) {
      setFehler(err.message);
    } finally {
      setSpeichertGerade(false);
    }
  }

  return (
    <div className="mobil-erfassen">
      <h1 className="seiten-titel">Neue Pendenz</h1>
      <p className="seiten-untertitel">Schnell aufnotieren -- landet im Eingang, dort planst du sie später ein.</p>

      <form onSubmit={speichern}>
        <div className="feld">
          <label htmlFor="mobil-titel">Titel</label>
          <input
            id="mobil-titel"
            ref={titelRef}
            type="text"
            value={titel}
            onChange={(e) => { setTitel(e.target.value); setGespeichert(false); }}
            placeholder="Was ist zu tun?"
            autoFocus
            required
          />
        </div>

        <div className="feld">
          <label htmlFor="mobil-bemerkung">Bemerkung</label>
          <textarea
            id="mobil-bemerkung"
            value={bemerkung}
            onChange={(e) => { setBemerkung(e.target.value); setGespeichert(false); }}
            placeholder="Optional -- weitere Details, Kontext, was noch zu klaeren ist…"
            rows={5}
          />
        </div>

        {fehler && <div className="hinweis-fehler">{fehler}</div>}
        {gespeichert && !fehler && <div className="mobil-erfassen-erfolg">✓ Gespeichert</div>}

        <button type="submit" className="btn btn-primary mobil-erfassen-speichern" disabled={!titel.trim() || speichertGerade}>
          {speichertGerade ? 'Speichert…' : 'Erfassen'}
        </button>
      </form>
    </div>
  );
}
