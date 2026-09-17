import { useState } from 'react';
import PendenzModal from './PendenzModal.jsx';
import Faelligkeitskalender from './Faelligkeitskalender.jsx';
import { useMandanten, useMitarbeitende } from '../hooks.js';
import { meldeAenderung } from '../events.js';
import api from '../api.js';

// Read-only-Planungsblick fuers Handy: derselbe Monatskalender wie im Cockpit (Tag antippen
// zeigt die faelligen Pendenzen darunter), damit man unterwegs sehen kann, was ansteht --
// antippen oeffnet bei Bedarf auch das volle Bearbeiten-Fenster.
export default function MobilKalender() {
  const [aktivePendenz, setAktivePendenz] = useState(null);
  const mandanten = useMandanten();
  const mitarbeitende = useMitarbeitende();

  async function statusAendern(pendenz, neuerStatus) {
    await api.pendenzen.statusAendern(pendenz.id, neuerStatus);
    meldeAenderung();
  }

  return (
    <div className="mobil-kalender">
      <h1 className="seiten-titel">Kalender</h1>
      <p className="seiten-untertitel">Tag antippen, um die fälligen Pendenzen zu sehen.</p>

      <Faelligkeitskalender onOeffnen={setAktivePendenz} onStatusAendern={statusAendern} />

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
