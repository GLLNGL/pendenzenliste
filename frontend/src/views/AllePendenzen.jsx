import { useCallback, useEffect, useState } from 'react';
import api from '../api.js';
import PendenzListe from '../components/PendenzListe.jsx';
import PendenzModal from '../components/PendenzModal.jsx';
import PendenzVorschau from '../components/PendenzVorschau.jsx';
import { useMandanten, useMitarbeitende } from '../hooks.js';
import { aufAenderungHoeren, meldeAenderung } from '../events.js';
import { STATUS_WERTE, OFFENE_STATUS, PRIORITAETEN } from '../constants.js';

// status: 'offen' = alle offenen Status (Standard, erledigte ausgeblendet),
// 'alle' = ohne Status-Einschraenkung, sonst ein einzelner Status-Wert.
const LEERE_FILTER = { status: 'offen', mandantId: '', prioritaet: '', von: '', bis: '', q: '', sort: 'faelligkeit_asc' };

// Uebersetzt die Filter-Auswahl in den fuer die API passenden status-Parameter.
function statusParameter(status) {
  if (status === 'offen') return OFFENE_STATUS.join(',');
  if (status === 'alle') return '';
  return status;
}

export default function AllePendenzen() {
  const [filter, setFilter] = useState(LEERE_FILTER);
  const [pendenzen, setPendenzen] = useState([]);
  const [fehler, setFehler] = useState(null);
  const [aktivePendenz, setAktivePendenz] = useState(null);
  const [vorschauPendenz, setVorschauPendenz] = useState(null);
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
    await api.pendenzen.statusAendern(pendenz.id, neuerStatus);
    meldeAenderung();
  }

  function filterFeld(name, wert) {
    setFilter((f) => ({ ...f, [name]: wert }));
  }

  const filterAktiv = JSON.stringify(filter) !== JSON.stringify(LEERE_FILTER);

  // Wie im Cockpit: den aktuellen Datensatz aus der frisch geladenen Liste nachschlagen statt
  // das alte vorschauPendenz-Objekt weiterzuverwenden, und automatisch ausblenden, sobald die
  // Pendenz (z.B. durch einen Filterwechsel) nicht mehr in der Liste ist.
  const angezeigtePendenz = vorschauPendenz
    ? pendenzen.find((p) => p.id === vorschauPendenz.id) ?? null
    : null;

  return (
    <div>
      <h1 className="seiten-titel">Alle Pendenzen</h1>
      <p className="seiten-untertitel">{pendenzen.length} Pendenz{pendenzen.length === 1 ? '' : 'en'}</p>

      <div className="filter-leiste">
        <input
          type="text"
          placeholder="Suche Titel/Beschreibung…"
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
          <option value="keiner">Kein Mandant (intern)</option>
          {mandanten.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select value={filter.prioritaet} onChange={(e) => filterFeld('prioritaet', e.target.value)}>
          <option value="">Alle Prioritäten</option>
          {PRIORITAETEN.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input type="date" value={filter.von} onChange={(e) => filterFeld('von', e.target.value)} title="Fällig von" />
        <input type="date" value={filter.bis} onChange={(e) => filterFeld('bis', e.target.value)} title="Fällig bis" />
        <select value={filter.sort} onChange={(e) => filterFeld('sort', e.target.value)}>
          <option value="faelligkeit_asc">Fälligkeit ↑</option>
          <option value="faelligkeit_desc">Fälligkeit ↓</option>
          <option value="prioritaet">Priorität</option>
          <option value="erstellt_am_desc">Zuletzt erstellt</option>
        </select>
        {filterAktiv && (
          <button type="button" className="filter-reset" onClick={() => setFilter(LEERE_FILTER)}>Filter zurücksetzen</button>
        )}
      </div>

      {fehler && <div className="hinweis-fehler">{fehler}</div>}

      {/* Gleiches Layout wie im Cockpit: Liste links, Vorschau der angeklickten Pendenz rechts --
          erst ein Klick in der Vorschau selbst oeffnet das Bearbeiten-Fenster. */}
      <div className="karte karte-kalender">
        <div className="uebersicht-layout">
          <div className="uebersicht-liste uebersicht-liste-voll">
            <PendenzListe
              pendenzen={pendenzen}
              onOeffnen={setAktivePendenz}
              onStatusAendern={statusAendern}
              leerText="Keine Pendenzen gefunden."
              ohneAbhaken
              onVorschau={setVorschauPendenz}
              vorschauId={angezeigtePendenz?.id}
            />
          </div>

          <PendenzVorschau pendenz={angezeigtePendenz} onOeffnen={setAktivePendenz} onStatusAendern={statusAendern} />
        </div>
      </div>

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
