import { useCallback, useEffect, useState } from 'react';
import api from '../api.js';
import PendenzArbeitsliste from '../components/PendenzArbeitsliste.jsx';
import PendenzModal from '../components/PendenzModal.jsx';
import { useMandanten, useMitarbeitende } from '../hooks.js';
import { aufAenderungHoeren, meldeAenderung } from '../events.js';
import { zuPlanen } from '../lib/tagesplan.js';

// Ordner "Zu planen" (Planung): alle offenen Pendenzen ohne Bearbeitungstag -- eine Uebersicht
// dessen, was noch eingeplant werden muss. Planen rechts in der Detailansicht (Heute, naechster
// Arbeitstag, Datum).
export default function ZuPlanen() {
  const [offene, setOffene] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [aktivePendenz, setAktivePendenz] = useState(null);
  const mandanten = useMandanten();
  const mitarbeitende = useMitarbeitende();

  const laden = useCallback(() => {
    api.pendenzen.offene().then((d) => { setOffene(d); setFehler(null); }).catch((e) => setFehler(e.message));
  }, []);
  useEffect(() => {
    laden();
    return aufAenderungHoeren(laden);
  }, [laden]);

  async function statusAendern(pendenz, neuerStatus) {
    try {
      await api.pendenzen.statusAendern(pendenz.id, neuerStatus);
      meldeAenderung();
    } catch (err) {
      window.alert(err.message);
    }
  }

  if (fehler) return <div className="fehleranzeige">Fehler beim Laden: {fehler}</div>;
  if (!offene) return <div className="ladeindikator">Lade…</div>;

  return (
    <div className="arbeitsseite">
      <div className="cockpit-kopfzeile">
        <h1 className="seiten-titel">Zu planen</h1>
        <span className="cockpit-kopf-hinweis">Alles ohne Bearbeitungstag – rechts in der Detailansicht auf Heute, den nächsten Arbeitstag oder ein Datum legen.</span>
      </div>
      <PendenzArbeitsliste
        titel="Noch nicht geplant"
        pendenzen={zuPlanen(offene)}
        leerText="Alles ist eingeplant."
        speicherSchluessel="zu-planen-eingeklappt"
        onOeffnen={setAktivePendenz}
        onStatusAendern={statusAendern}
      />
      {aktivePendenz && (
        <PendenzModal
          key={aktivePendenz.id}
          pendenz={aktivePendenz}
          mandanten={mandanten}
          mitarbeitende={mitarbeitende}
          onSchliessen={() => setAktivePendenz(null)}
          onGespeichert={() => setAktivePendenz(null)}
          onGeloescht={() => setAktivePendenz(null)}
        />
      )}
    </div>
  );
}
