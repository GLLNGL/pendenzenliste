import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api.js';
import { OFFERT_STATUS, betragMonat, chf } from '../lib/offerte.js';
import { formatiereDatum, heutigesDatumISO } from '../format.js';

const FILTER_SCHLUESSEL = 'offerten-status';

function statusLesen() {
  try { return localStorage.getItem(FILTER_SCHLUESSEL) || ''; } catch { return ''; }
}

// Programm "Offerten" im Modul Offerten: Liste aller Offerten, Klick oeffnet den Editor.
export default function Offerten() {
  const [offerten, setOfferten] = useState([]);
  const [fehler, setFehler] = useState(null);
  const [status, setStatus] = useState(statusLesen);
  const [suche, setSuche] = useState('');
  const navigate = useNavigate();

  const laden = useCallback(() => {
    api.offerten.liste().then((o) => { setOfferten(o); setFehler(null); }).catch((e) => setFehler(e.message));
  }, []);
  useEffect(() => { laden(); }, [laden]);

  function statusWaehlen(wert) {
    setStatus(wert);
    try { localStorage.setItem(FILTER_SCHLUESSEL, wert); } catch { /* ohne Speicher weiter */ }
  }

  const heute = heutigesDatumISO();
  const sichtbar = offerten.filter((o) => (!status || o.status === status)
    && (!suche || `${o.nummer} ${o.mandanten?.name ?? ''}`.toLowerCase().includes(suche.toLowerCase())));

  return (
    <div className="offerten-seite">
      <div className="cockpit-kopfzeile">
        <h1 className="seiten-titel">Offerten</h1>
        <span className="cockpit-kopf-hinweis">Offerte erstellen, drucken oder per E-Mail senden – angenommen wird daraus das Mandat mit seinen Pauschalen.</span>
        <span className="kopfzeile-aktionen">
          <button type="button" className="btn btn-primary" onClick={() => navigate('/offerten/neu')}>+ Neue Offerte</button>
        </span>
      </div>

      <div className="filter-leiste">
        <input type="search" placeholder="Suche Nr. oder Mandant" value={suche} onChange={(e) => setSuche(e.target.value)} />
        <select value={status} onChange={(e) => statusWaehlen(e.target.value)}>
          <option value="">Alle Status</option>
          {OFFERT_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {fehler && (
        <div className="hinweis-fehler">
          Fehler beim Laden: {fehler}
          {/relation|does not exist|schema cache/i.test(fehler) && ' – ist die Schema-Erweiterung (supabase/schema.sql) schon ausgeführt?'}
        </div>
      )}

      <div className="karte">
        <table className="tabelle">
          <thead>
            <tr>
              <th>Angebot-Nr.</th><th>Datum</th><th>Mandant</th><th>Bearbeiter</th><th>Status</th>
              <th className="zahl">Netto/Mt.</th><th className="zahl">nach Rabatt</th><th>Gültig bis</th>
            </tr>
          </thead>
          <tbody>
            {sichtbar.map((o) => {
              const netto = (o.offert_positionen || []).reduce((s, p) => s + betragMonat(p), 0);
              const nachRabatt = netto * (1 - Number(o.rabatt_prozent || 0) / 100);
              const abgelaufen = ['Entwurf', 'Versendet'].includes(o.status) && o.gueltig_bis < heute;
              return (
                <tr key={o.id} className="klickbar" onClick={() => navigate(`/offerten/${o.id}`)}>
                  <td><strong>{o.nummer}</strong></td>
                  <td>{formatiereDatum(o.datum)}</td>
                  <td>
                    {o.mandanten?.name}
                    {o.mandanten?.potenziell && <> <span className="tag-potenziell">pot.</span></>}
                  </td>
                  <td>{o.mitarbeitende?.name ?? '–'}</td>
                  <td><span className={`offert-status offert-status-${o.status.toLowerCase()}`}>{o.status}</span></td>
                  <td className="zahl">{chf(netto)}</td>
                  <td className="zahl">{chf(nachRabatt)}</td>
                  <td className={abgelaufen ? 'text-ueberfaellig' : ''}>{formatiereDatum(o.gueltig_bis)}{abgelaufen ? ' (abgelaufen)' : ''}</td>
                </tr>
              );
            })}
            {sichtbar.length === 0 && !fehler && (
              <tr><td colSpan={8} className="leer-hinweis">{offerten.length ? 'Keine Offerten für diesen Filter.' : 'Noch keine Offerten – «+ Neue Offerte» oben rechts.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
