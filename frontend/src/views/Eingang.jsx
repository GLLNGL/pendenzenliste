import { useCallback, useEffect, useState } from 'react';
import api from '../api.js';
import PendenzModal from '../components/PendenzModal.jsx';
import { useMandanten, useMitarbeitende } from '../hooks.js';
import { formatiereZeitstempel } from '../format.js';
import { aufAenderungHoeren } from '../events.js';

// Sammelbecken fuer unterwegs erfasste Notizen (siehe MobilErfassen.jsx, geplant:false) --
// diese Pendenzen tauchen bewusst noch NICHT in Cockpit/Alle Pendenzen/Mandanten auf, bis sie
// hier geoeffnet und im vollen Formular gespeichert (= eingeplant) wurden.
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
      <h1 className="seiten-titel">Eingang</h1>
      <p className="seiten-untertitel">Unterwegs erfasste Notizen -- hier öffnen, um sie einem Mandanten/einer Fälligkeit zuzuordnen. Danach erscheinen sie ganz normal in Cockpit und Alle Pendenzen.</p>

      <div className="karte">
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
