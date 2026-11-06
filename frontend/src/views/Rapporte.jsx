import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api.js';
import { aufZeitAenderungHoeren } from '../events.js';
import { formatiereDatum } from '../format.js';
import { betragExtra } from '../lib/zeit.js';
import { stundenText } from '../lib/rapport.js';
import { chf } from '../lib/offerte.js';

// Programm "Detailrapporte": oben die noch nicht verrechnete Zeit pro Mandant (Rapport direkt
// daraus erstellen), darunter die abgeschlossenen Rapporte.
export default function Rapporte() {
  const [rapporte, setRapporte] = useState([]);
  const [offen, setOffen] = useState([]);
  const [fehler, setFehler] = useState(null);
  const navigate = useNavigate();

  const laden = useCallback(() => {
    Promise.all([api.rapporte.liste(), api.rapporte.offen()])
      .then(([r, o]) => { setRapporte(r); setOffen(o); setFehler(null); })
      .catch((e) => setFehler(e.message));
  }, []);
  useEffect(() => {
    laden();
    return aufZeitAenderungHoeren(laden);
  }, [laden]);

  const proMandant = new Map();
  for (const e of offen) {
    const m = proMandant.get(e.mandant_id) || { id: e.mandant_id, name: e.mandanten?.name ?? '–', pauschal: 0, extra: 0, betrag: 0, aeltester: e.datum, juengster: e.datum };
    m[e.art === 'extra' ? 'extra' : 'pauschal'] += e.minuten;
    m.betrag += betragExtra(e) ?? 0;
    if (e.datum < m.aeltester) m.aeltester = e.datum;
    if (e.datum > m.juengster) m.juengster = e.datum;
    proMandant.set(e.mandant_id, m);
  }
  const offeneListe = [...proMandant.values()].sort((a, b) => a.name.localeCompare(b.name, 'de-CH'));

  return (
    <div className="offerten-seite">
      <div className="cockpit-kopfzeile">
        <h1 className="seiten-titel">Detailrapporte</h1>
        <span className="cockpit-kopf-hinweis">Rapport pro Mandant und Zeitraum – wird mit der Rechnung versendet; die Zeit gilt danach als verrechnet.</span>
        <span className="kopfzeile-aktionen">
          <button type="button" className="btn btn-primary" onClick={() => navigate('/rapporte/neu')}>+ Neuer Rapport</button>
        </span>
      </div>
      {fehler && (
        <div className="hinweis-fehler">
          Fehler beim Laden: {fehler}
          {/relation|does not exist|schema cache/i.test(fehler) && ' – ist die Schema-Erweiterung (supabase/schema.sql) schon ausgeführt?'}
        </div>
      )}

      <h2 className="abschnitt-titel">Noch nicht verrechnet</h2>
      <div className="karte">
        <table className="tabelle">
          <thead><tr><th>Mandant</th><th>Zeitraum</th><th className="zahl">Pauschale</th><th className="zahl">Extra</th><th className="zahl">Extra CHF</th><th></th></tr></thead>
          <tbody>
            {offeneListe.map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td>{formatiereDatum(m.aeltester)} – {formatiereDatum(m.juengster)}</td>
                <td className="zahl">{stundenText(m.pauschal)}</td>
                <td className="zahl">{stundenText(m.extra)}</td>
                <td className="zahl">{chf(m.betrag).replace('CHF ', '')}</td>
                <td className="spalte-aktionen">
                  <button type="button" className="btn-klein" onClick={() => navigate(`/rapporte/neu?mandant=${m.id}&von=${m.aeltester}&bis=${m.juengster}`)}>Rapport erstellen</button>
                </td>
              </tr>
            ))}
            {offeneListe.length === 0 && !fehler && <tr><td colSpan={6} className="leer-hinweis">Alle erfasste Mandanten-Zeit ist verrechnet.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2 className="abschnitt-titel">Abgeschlossene Rapporte</h2>
      <div className="karte">
        <table className="tabelle">
          <thead>
            <tr><th>Rapport-Nr.</th><th>Datum</th><th>Mandant</th><th>Zeitraum</th><th className="zahl">Pauschale</th><th className="zahl">Extra</th><th className="zahl">Extra CHF</th><th>Rechnung</th><th>Versendet</th></tr>
          </thead>
          <tbody>
            {rapporte.map((r) => (
              <tr key={r.id} className="klickbar" onClick={() => navigate(`/rapporte/${r.id}`)}>
                <td><strong>{r.nummer}</strong></td>
                <td>{formatiereDatum(r.datum)}</td>
                <td>{r.mandanten?.name}</td>
                <td>{formatiereDatum(r.von)} – {formatiereDatum(r.bis)}</td>
                <td className="zahl">{stundenText(r.minuten_pauschal)}</td>
                <td className="zahl">{stundenText(r.minuten_extra)}</td>
                <td className="zahl">{chf(r.betrag_extra).replace('CHF ', '')}</td>
                <td>{r.rechnung_nr ?? '–'}</td>
                <td>{r.versendet_am ? formatiereDatum(r.versendet_am.slice(0, 10)) : '–'}</td>
              </tr>
            ))}
            {rapporte.length === 0 && !fehler && <tr><td colSpan={9} className="leer-hinweis">Noch keine Rapporte.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
