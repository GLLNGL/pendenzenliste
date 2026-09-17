import { useCallback, useEffect, useState } from 'react';
import api from '../api.js';
import { useMandanten, useMitarbeitende } from '../hooks.js';
import { formatiereDatum } from '../format.js';
import Badge from '../components/Badge.jsx';
import PendenzModal from '../components/PendenzModal.jsx';

const LEERE_FILTER = { mandantId: '', erledigtVon: '', erledigtBis: '' };

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

  useEffect(() => { laden(); }, [laden]);

  function filterFeld(name, wert) {
    setFilter((f) => ({ ...f, [name]: wert }));
  }

  if (fehler) return <div className="fehleranzeige">Fehler beim Laden: {fehler}</div>;

  return (
    <div>
      <h1 className="seiten-titel">Archiv</h1>
      <p className="seiten-untertitel">Erledigte Pendenzen – für Rückfragen und Leistungsnachvollzug.</p>

      <div className="filter-leiste">
        <select value={filter.mandantId} onChange={(e) => filterFeld('mandantId', e.target.value)}>
          <option value="">Alle Mandanten</option>
          <option value="keiner">Kein Mandant (intern)</option>
          {mandanten.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <input type="date" value={filter.erledigtVon} onChange={(e) => filterFeld('erledigtVon', e.target.value)} title="Erledigt von" />
        <input type="date" value={filter.erledigtBis} onChange={(e) => filterFeld('erledigtBis', e.target.value)} title="Erledigt bis" />
        {(filter.mandantId || filter.erledigtVon || filter.erledigtBis) && (
          <button type="button" className="filter-reset" onClick={() => setFilter(LEERE_FILTER)}>Filter zurücksetzen</button>
        )}
      </div>

      <div className="karte">
        <table className="tabelle">
          <thead>
            <tr>
              <th>ID</th>
              <th>Titel</th>
              <th>Mandant</th>
              <th>Priorität</th>
              <th>Fällig gewesen</th>
              <th>Erledigt am</th>
              <th>Aufwand</th>
            </tr>
          </thead>
          <tbody>
            {pendenzen.map((p) => (
              <tr key={p.id} onClick={() => setAktivePendenz(p)} style={{ cursor: 'pointer' }}>
                <td className="zeile-id">{p.id}</td>
                <td>{p.titel}</td>
                <td>{p.mandant_name || '–'}</td>
                <td><Badge prioritaet={p.prioritaet} /></td>
                <td>{formatiereDatum(p.faelligkeit)}</td>
                <td>{formatiereDatum(p.erledigt_am)}</td>
                <td>{p.aufwand_stunden ?? '–'}</td>
              </tr>
            ))}
            {pendenzen.length === 0 && (
              <tr><td colSpan={7} className="leer-hinweis">Keine erledigten Pendenzen im gewählten Zeitraum.</td></tr>
            )}
          </tbody>
        </table>
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
