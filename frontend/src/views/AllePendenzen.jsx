import { useCallback, useEffect, useState } from 'react';
import api from '../api.js';
import PendenzArbeitsliste from '../components/PendenzArbeitsliste.jsx';
import PendenzModal from '../components/PendenzModal.jsx';
import { useMandanten, useMitarbeitende } from '../hooks.js';
import { aufAenderungHoeren, meldeAenderung } from '../events.js';
import { STATUS_WERTE, OFFENE_STATUS, PRIORITAETEN, BLOECKE } from '../constants.js';

// status: 'offen' = alle offenen Status (Standard, erledigte ausgeblendet),
// 'alle' = ohne Status-Einschraenkung, sonst ein einzelner Status-Wert.
const LEERE_FILTER = { status: 'offen', mandantId: '', prioritaet: '', block: '', von: '', bis: '', q: '', sort: 'faelligkeit_asc' };

// Uebersetzt die Filter-Auswahl in den fuer die API passenden status-Parameter.
function statusParameter(status) {
  if (status === 'offen') return OFFENE_STATUS.join(',');
  if (status === 'alle') return '';
  return status;
}

// Gleiches Layout wie das Cockpit: schmale Kopfzeile, Filterleiste, darunter die Arbeitskarte
// (nach Mandant gruppiert und einklappbar, geschaetzte Zeit, Detailansicht rechts), die die
// restliche Fensterhoehe fuellt.
export default function AllePendenzen() {
  const [filter, setFilter] = useState(LEERE_FILTER);
  const [pendenzen, setPendenzen] = useState([]);
  const [fehler, setFehler] = useState(null);
  const [aktivePendenz, setAktivePendenz] = useState(null);
  const mandanten = useMandanten();
  const mitarbeitende = useMitarbeitende();

  const laden = useCallback(() => {
    api.pendenzen.liste({ ...filter, status: statusParameter(filter.status) })
      .then(setPendenzen).catch((e) => setFehler(e.message));
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

  const filterAktiv = JSON.stringify(filter) !== JSON.stringify(LEERE_FILTER);

  return (
    <div className="arbeitsseite">
      <div className="cockpit-kopfzeile">
        <h1 className="seiten-titel">Alle Pendenzen</h1>
        <span className="cockpit-kopf-hinweis">Suchen und filtern über alle Mandanten – Klick auf eine Pendenz zeigt rechts die Details.</span>
      </div>

      <div className="filter-leiste filter-leiste-kompakt">
        <input
          type="text"
          placeholder="Suche nächster Schritt/Beschreibung…"
          value={filter.q}
          onChange={(e) => filterFeld('q', e.target.value)}
        />
        <select value={filter.status} onChange={(e) => filterFeld('status', e.target.value)}>
          <option value="offen">Offene Pendenzen</option>
          <option value="alle">Alle inkl. erledigte</option>
          {STATUS_WERTE.map((s) => <option key={s} value={s}>Nur: {s}</option>)}
        </select>
        <select value={filter.mandantId} onChange={(e) => filterFeld('mandantId', e.target.value)}>
          <option value="">Alle Mandanten</option>
          <option value="keiner">Intern (eigenes Büro)</option>
          {mandanten.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select value={filter.prioritaet} onChange={(e) => filterFeld('prioritaet', e.target.value)}>
          <option value="">Alle Prioritäten</option>
          {PRIORITAETEN.map((p) => <option key={p} value={p}>Priorität {p}</option>)}
        </select>
        <select value={filter.block} onChange={(e) => filterFeld('block', e.target.value)}>
          <option value="">Alle Blöcke</option>
          {BLOECKE.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <input type="date" value={filter.von} onChange={(e) => filterFeld('von', e.target.value)} title="Fällig von" />
        <input type="date" value={filter.bis} onChange={(e) => filterFeld('bis', e.target.value)} title="Fällig bis" />
        {filterAktiv && (
          <button type="button" className="filter-reset" onClick={() => setFilter(LEERE_FILTER)}>Filter zurücksetzen</button>
        )}
      </div>

      {fehler && <div className="hinweis-fehler">{fehler}</div>}

      <PendenzArbeitsliste
        titel="Pendenzen"
        pendenzen={pendenzen}
        leerText="Keine Pendenzen gefunden."
        speicherSchluessel="alle-pendenzen-eingeklappt"
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
