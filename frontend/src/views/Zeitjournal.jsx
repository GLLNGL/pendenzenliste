import { useCallback, useEffect, useState } from 'react';
import api from '../api.js';
import ZeitModal from '../components/ZeitModal.jsx';
import MandantSuche from '../components/MandantSuche.jsx';
import { useMandanten, useMitarbeitende } from '../hooks.js';
import { aufZeitAenderungHoeren } from '../events.js';
import { formatiereDatum, heutigesDatumISO } from '../format.js';
import {
  ZEIT_ARTEN, artLabel, formatiereDauer, formatiereStundenSumme, laufendeMinuten, betragExtra, zusammenfassung, zeitraum,
} from '../lib/zeit.js';
import { chf } from '../lib/offerte.js';

const ZEITRAEUME = [
  { wert: 'woche', label: 'Diese Woche' },
  { wert: 'vorwoche', label: 'Letzte Woche' },
  { wert: 'monat', label: 'Dieser Monat' },
  { wert: 'vormonat', label: 'Letzter Monat' },
  { wert: 'jahr', label: 'Dieses Jahr' },
  { wert: 'frei', label: 'Frei wählen' },
];
const FILTER_SCHLUESSEL = 'zeitjournal-filter';

function filterLesen() {
  try {
    const f = JSON.parse(localStorage.getItem(FILTER_SCHLUESSEL) || '{}');
    return { zeitraum: 'monat', von: '', bis: '', mandantId: '', mitarbeiterId: '', art: '', ...f };
  } catch {
    return { zeitraum: 'monat', von: '', bis: '', mandantId: '', mitarbeiterId: '', art: '' };
  }
}

// Programm "Zeitjournal" im Modul Zeiterfassung: alle erfassten Zeiten, filterbar und
// korrigierbar, mit Summen Pauschale / Extra / Intern.
export default function Zeitjournal() {
  const [filter, setFilter] = useState(filterLesen);
  const [eintraege, setEintraege] = useState([]);
  const [fehler, setFehler] = useState(null);
  const [offen, setOffen] = useState(null); // { eintrag } | { neu: true }
  const mandanten = useMandanten();
  const mitarbeitende = useMitarbeitende();

  const heute = heutigesDatumISO();
  const bereich = filter.zeitraum === 'frei' ? { von: filter.von, bis: filter.bis } : zeitraum(filter.zeitraum, heute);

  const laden = useCallback(() => {
    api.zeit.liste({ ...bereich, mandantId: filter.mandantId, mitarbeiterId: filter.mitarbeiterId, art: filter.art })
      .then((d) => { setEintraege(d); setFehler(null); })
      .catch((e) => setFehler(e.message));
    // bereich ergibt sich vollstaendig aus filter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    laden();
    return aufZeitAenderungHoeren(laden);
  }, [laden]);

  function aendern(feld, wert) {
    setFilter((f) => {
      const neu = { ...f, [feld]: wert };
      try { localStorage.setItem(FILTER_SCHLUESSEL, JSON.stringify(neu)); } catch { /* ohne Speicher weiter */ }
      return neu;
    });
  }

  const s = zusammenfassung(eintraege);

  return (
    <div className="zeitjournal-seite">
      <div className="cockpit-kopfzeile">
        <h1 className="seiten-titel">Zeitjournal</h1>
        <span className="cockpit-kopf-hinweis">Alle erfassten Zeiten – Klick auf eine Zeile korrigiert den Eintrag.</span>
        <span className="kopfzeile-aktionen">
          <button type="button" className="btn btn-primary" onClick={() => setOffen({ neu: true })}>+ Zeit erfassen</button>
        </span>
      </div>

      <div className="filter-leiste">
        <select value={filter.zeitraum} onChange={(e) => aendern('zeitraum', e.target.value)} aria-label="Zeitraum">
          {ZEITRAEUME.map((z) => <option key={z.wert} value={z.wert}>{z.label}</option>)}
        </select>
        {filter.zeitraum === 'frei' && (
          <>
            <input type="date" value={filter.von} onChange={(e) => aendern('von', e.target.value)} aria-label="von" />
            <input type="date" value={filter.bis} onChange={(e) => aendern('bis', e.target.value)} aria-label="bis" />
          </>
        )}
        <div className="zeitjournal-mandant">
          <MandantSuche mandanten={mandanten} wert={filter.mandantId === 'intern' ? '' : filter.mandantId} onWahl={(w) => aendern('mandantId', w)} leerText="Alle Mandanten" />
          {filter.mandantId && <button type="button" className="btn-klein" onClick={() => aendern('mandantId', '')}>× alle</button>}
        </div>
        <select value={filter.mitarbeiterId} onChange={(e) => aendern('mitarbeiterId', e.target.value)} aria-label="Person">
          <option value="">Alle Personen</option>
          {mitarbeitende.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
        </select>
        <select value={filter.art} onChange={(e) => aendern('art', e.target.value)} aria-label="Art">
          <option value="">Alle Arten</option>
          {ZEIT_ARTEN.map((a) => <option key={a.wert} value={a.wert}>{a.label}</option>)}
        </select>
      </div>

      <div className="zeit-summen">
        <span><strong>{formatiereStundenSumme(s.gesamt)}</strong> total</span>
        <span><span className="zeit-art zeit-art-pauschal">Pauschale</span> {formatiereStundenSumme(s.pauschal)}</span>
        <span><span className="zeit-art zeit-art-extra">Extra</span> {formatiereStundenSumme(s.extra)} · {chf(s.extraBetrag)}</span>
        <span><span className="zeit-art">Intern</span> {formatiereStundenSumme(s.intern)}</span>
        {s.laufend > 0 && <span className="zeit-laufend">{s.laufend} Timer läuft</span>}
        {bereich?.von && <span className="zeit-zeitraum">{formatiereDatum(bereich.von)} – {formatiereDatum(bereich.bis)}</span>}
      </div>

      {fehler && <div className="hinweis-fehler">Fehler beim Laden: {fehler}</div>}

      <div className="karte">
        <table className="tabelle">
          <thead>
            <tr>
              <th>Datum</th><th>Person</th><th>Mandant</th><th>Tätigkeit</th><th>Leistung</th><th>Art</th>
              <th className="zahl">Dauer</th><th className="zahl">CHF</th>
            </tr>
          </thead>
          <tbody>
            {eintraege.map((e) => {
              const laeuft = e.minuten == null;
              const betrag = betragExtra(e);
              return (
                <tr key={e.id} className="klickbar" onClick={() => setOffen({ eintrag: e })}>
                  <td>{formatiereDatum(e.datum)}</td>
                  <td>{e.mitarbeitende?.name ?? '–'}</td>
                  <td>{e.mandanten?.name ?? <span className="tag-inaktiv">INTERN</span>}</td>
                  <td className="zeit-taetigkeit">
                    {e.beschreibung || e.pendenzen?.titel || '–'}
                    {e.pendenzen?.titel && e.beschreibung && e.beschreibung !== e.pendenzen.titel && <div className="zeit-pendenz">Pendenz: {e.pendenzen.titel}</div>}
                    {e.rapport_id && <div className="zeit-pendenz">verrechnet</div>}
                  </td>
                  <td>{e.leistungen?.name ?? '–'}</td>
                  <td><span className={`zeit-art zeit-art-${e.art}`}>{artLabel(e.art)}</span></td>
                  <td className="zahl">{laeuft ? <span className="zeit-laufend">läuft {formatiereDauer(laufendeMinuten(e.timer_start))}</span> : formatiereDauer(e.minuten)}</td>
                  <td className="zahl">{betrag == null ? '' : chf(betrag).replace('CHF ', '')}</td>
                </tr>
              );
            })}
            {eintraege.length === 0 && !fehler && <tr><td colSpan={8} className="leer-hinweis">Keine Zeiten in diesem Zeitraum.</td></tr>}
          </tbody>
        </table>
      </div>

      {offen && (
        <ZeitModal eintrag={offen.eintrag ?? null} onSchliessen={() => setOffen(null)} onGespeichert={() => setOffen(null)} />
      )}
    </div>
  );
}
