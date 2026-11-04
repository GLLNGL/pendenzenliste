import { useCallback, useEffect, useState } from 'react';
import api from '../api.js';
import { useMandanten, useMitarbeitende } from '../hooks.js';
import { aufAenderungHoeren, meldeAenderung } from '../events.js';
import PendenzArbeitsliste from '../components/PendenzArbeitsliste.jsx';
import PendenzModal from '../components/PendenzModal.jsx';

const LEERE_FILTER = { mandantId: '', erledigtVon: '', erledigtBis: '' };

// Erledigte Pendenzen -- gleiches Layout wie Cockpit und Alle Pendenzen (nach Mandant gruppiert,
// einklappbar, Detailansicht rechts), mit dem Erledigt-Datum statt der Frist. Die geschaetzte
// Zeit im Kopf hilft beim Leistungsnachvollzug.
export default function Archiv() {
  const [filter, setFilter] = useState(LEERE_FILTER);
  const [pendenzen, setPendenzen] = useState([]);
  const [fehler, setFehler] = useState(null);
  const [aktivePendenz, setAktivePendenz] = useState(null);
  const mandanten = useMandanten();
  const mitarbeitende = useMitarbeitende();

  const laden = useCallback(() => {
    api.pendenzen.liste({ status: 'Erledigt', sort: 'erledigt_am_desc', ...filter })
      .then(setPendenzen)
      .catch((e) => setFehler(e.message));
  }, [filter]);

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

  function filterFeld(name, wert) {
    setFilter((f) => ({ ...f, [name]: wert }));
  }

  if (fehler) return <div className="fehleranzeige">Fehler beim Laden: {fehler}</div>;

  return (
    <div className="arbeitsseite">
      <div className="cockpit-kopfzeile">
        <h1 className="seiten-titel">Archiv</h1>
        <span className="cockpit-kopf-hinweis">Erledigte Pendenzen – für Rückfragen und Leistungsnachvollzug.</span>
      </div>

      <div className="filter-leiste filter-leiste-kompakt">
        <select value={filter.mandantId} onChange={(e) => filterFeld('mandantId', e.target.value)}>
          <option value="">Alle Mandanten</option>
          <option value="keiner">Intern (eigenes Büro)</option>
          {mandanten.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <input type="date" value={filter.erledigtVon} onChange={(e) => filterFeld('erledigtVon', e.target.value)} title="Erledigt von" />
        <input type="date" value={filter.erledigtBis} onChange={(e) => filterFeld('erledigtBis', e.target.value)} title="Erledigt bis" />
        {(filter.mandantId || filter.erledigtVon || filter.erledigtBis) && (
          <button type="button" className="filter-reset" onClick={() => setFilter(LEERE_FILTER)}>Filter zurücksetzen</button>
        )}
      </div>

      <PendenzArbeitsliste
        titel="Erledigt"
        pendenzen={pendenzen}
        datum="erledigt_am"
        leerText="Keine erledigten Pendenzen im gewählten Zeitraum."
        speicherSchluessel="archiv-eingeklappt"
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
          onGespeichert={() => { setAktivePendenz(null); laden(); }}
          onGeloescht={() => { setAktivePendenz(null); laden(); }}
        />
      )}
    </div>
  );
}
