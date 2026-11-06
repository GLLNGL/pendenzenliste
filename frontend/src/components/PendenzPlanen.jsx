import { useState } from 'react';
import api from '../api.js';
import { meldeAenderung } from '../events.js';
import { heutigesDatumISO, formatiereDatum } from '../format.js';
import { plusArbeitstage } from '../lib/vorschlaege.js';
import { morgenTitel } from '../lib/tagesplan.js';

// Planen in der Detailansicht: Bearbeitungstag setzen (Heute / naechster Arbeitstag / Datum)
// oder entfernen -- ohne Bearbeitungstag liegt die Pendenz im Ordner "Zu planen".
export default function PendenzPlanen({ pendenz }) {
  const [fehler, setFehler] = useState(null);
  const heute = heutigesDatumISO();
  const morgen = plusArbeitstage(heute, 1);

  async function setzen(tag) {
    setFehler(null);
    try {
      await api.pendenzen.aktualisieren(pendenz.id, { bearbeitungstag: tag || null });
      meldeAenderung();
    } catch (e) {
      setFehler(e.message);
    }
  }

  const tag = pendenz.bearbeitungstag;
  return (
    <div className="pendenz-vorschau-fortschritt pendenz-planen" onClick={(e) => e.stopPropagation()}>
      <div className="pendenz-vorschau-teilaufgaben-titel">
        Planen
        <span className="teilaufgaben-zaehler">{tag ? `bearbeiten am ${formatiereDatum(tag)}` : 'noch nicht geplant (Zu planen)'}</span>
      </div>
      <div className="pendenz-planen-knoepfe">
        <button type="button" className={`btn-klein ${tag === heute ? 'gewaehlt' : ''}`} onClick={() => setzen(heute)}>Heute</button>
        <button type="button" className={`btn-klein ${tag === morgen ? 'gewaehlt' : ''}`} onClick={() => setzen(morgen)}>{morgenTitel(heute, morgen)}</button>
        <input type="date" value={tag || ''} onChange={(e) => setzen(e.target.value)} aria-label="Bearbeitungstag" />
        {tag && <button type="button" className="btn-klein" onClick={() => setzen(null)} title="In den Ordner «Zu planen»">Zu planen</button>}
      </div>
      {fehler && <div className="hinweis-fehler">{fehler}</div>}
    </div>
  );
}
