import { useEffect, useState } from 'react';
import api from '../api.js';
import { leseZugriffErlauben } from '../lib/ablageOrdner.js';
import BelegVorschau from './BelegVorschau.jsx';

// Belege einer Pendenz gut sichtbar als Knoepfe (z.B. im Kopf unter dem Titel): ein Klick oeffnet
// den Beleg direkt in der App. Abgelegte Belege ohne gespeicherten Pfad lassen sich nicht oeffnen
// und erscheinen darum nicht.
export default function BelegKnoepfe({ pendenzIds, stand = 0 }) {
  const [dateien, setDateien] = useState([]);
  const [ansicht, setAnsicht] = useState(null);
  const schluessel = (pendenzIds ?? []).join(',');

  useEffect(() => {
    if (!schluessel) return undefined;
    let aktiv = true;
    api.dateien.liste({ pendenzIds: schluessel.split(',').map(Number) })
      .then((l) => { if (aktiv) setDateien(l.filter((d) => d.speicherpfad || d.abgelegt_in)); })
      .catch(() => { if (aktiv) setDateien([]); });
    return () => { aktiv = false; };
  }, [schluessel, stand]);

  if (!dateien.length) return null;

  // Abgelegter Beleg: Lesezugriff gleich im Klick anfragen (spaeter blockiert der Browser die
  // Rueckfrage); das Fenster oeffnet sofort, auch wenn die Rueckfrage noch offen ist.
  function oeffnen(d) {
    if (!d.speicherpfad) leseZugriffErlauben().catch(() => {});
    setAnsicht(d);
  }

  return (
    <div className="beleg-knoepfe" aria-label="Belege">
      {dateien.map((d) => (
        <button key={d.id} type="button" className="beleg-knopf" onClick={() => oeffnen(d)} title={`Beleg ansehen: ${d.dateiname}`}>
          <span aria-hidden="true">{/\.pdf$/i.test(d.dateiname) ? '📄' : /\.(png|jpe?g|gif|webp)$/i.test(d.dateiname) ? '🖼' : '📎'}</span>
          <span className="beleg-knopf-name">{d.dateiname}</span>
        </button>
      ))}
      {ansicht && <BelegVorschau datei={ansicht} onSchliessen={() => setAnsicht(null)} />}
    </div>
  );
}
