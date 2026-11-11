import { useEffect, useRef, useState } from 'react';
import api from '../api.js';
import { hintergrundSchliessen } from '../lib/modal.js';
import { camtLesen, csvAuszugLesen, abgleichen } from '../lib/kontoauszug.js';
import { csvZerlegen, xlsxZeilen } from '../lib/buchungsjournal.js';
import { plusTage } from '../lib/liquiditaet.js';
import { chf } from '../lib/offerte.js';
import { formatiereDatum } from '../format.js';

const SICHERHEIT = { sicher: 'sicher', wahrscheinlich: 'prüfen', unsicher: 'unsicher' };

async function dateiLesen(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xml')) return camtLesen(await file.text());
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return api.kontoauszugLesen(file);
  if (name.endsWith('.xlsx')) {
    const r = csvAuszugLesen(await xlsxZeilen(await file.arrayBuffer()));
    if (!r) throw new Error('Spalten Datum und Gutschrift/Betrag nicht gefunden.');
    return r;
  }
  const r = csvAuszugLesen(csvZerlegen(await file.text()));
  if (!r) throw new Error('Spalten Datum und Gutschrift/Betrag nicht gefunden.');
  return r;
}

// Debitoren: Kontoauszug einlesen, Zahlungseingaenge mit offenen Rechnungen abgleichen,
// Zuordnung pruefen und die Rechnungen als bezahlt verbuchen (optional Kontostand uebernehmen).
export default function KontoauszugModal({ debitoren, onSchliessen, onVerbucht }) {
  const [zustand, setZustand] = useState('auswahl'); // auswahl | liest | pruefen | verbucht
  const [fehler, setFehler] = useState(null);
  const [zeilen, setZeilen] = useState([]); // [{ buchung, belegId, sicherheit, grund, verbuchen }]
  const [saldo, setSaldo] = useState(null);
  const [saldoUebernehmen, setSaldoUebernehmen] = useState(true);
  const [belastungen, setBelastungen] = useState(0);
  const [ziehen, setZiehen] = useState(false);
  const eingabeRef = useRef(null);

  useEffect(() => {
    function onKeyDown(e) { if (e.key === 'Escape') onSchliessen(); }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSchliessen]);

  async function einlesen(files) {
    const liste = [...files];
    if (!liste.length) return;
    setFehler(null);
    setZustand('liest');
    try {
      const buchungen = [];
      let letzterSaldo = null;
      for (const f of liste) {
        const r = await dateiLesen(f);
        buchungen.push(...r.buchungen);
        if (r.schlusssaldo && (!letzterSaldo || (r.schlusssaldo.datum ?? '') >= (letzterSaldo.datum ?? ''))) letzterSaldo = r.schlusssaldo;
      }
      const ergebnis = abgleichen(buchungen, debitoren);
      setZeilen(ergebnis.map((e) => ({
        buchung: e.buchung, belegId: e.beleg ? String(e.beleg.id) : '', sicherheit: e.sicherheit, grund: e.grund,
        verbuchen: e.sicherheit === 'sicher' || e.sicherheit === 'wahrscheinlich',
      })));
      setBelastungen(buchungen.filter((b) => b.richtung === 'belastung').length);
      setSaldo(letzterSaldo);
      setZustand('pruefen');
    } catch (err) {
      setFehler(err.message);
      setZustand('auswahl');
    }
  }

  function zeileAendern(i, patch) {
    setZeilen((alt) => alt.map((z, j) => (j === i ? { ...z, ...patch } : z)));
  }

  const offen = debitoren.filter((d) => !d.bezahlt_am);
  const zuVerbuchen = zeilen.filter((z) => z.verbuchen && z.belegId);
  const doppelt = new Set(zuVerbuchen.map((z) => z.belegId).filter((id, i, a) => a.indexOf(id) !== i));

  async function verbuchen() {
    setFehler(null);
    try {
      for (const z of zuVerbuchen) await api.belege.bezahlt(Number(z.belegId), z.buchung.datum);
      if (saldo && saldoUebernehmen) {
        const aktuell = await api.buero.lesen('buchhaltung');
        // Schlusssaldo enthaelt die Zahlungen des letzten Auszugstags -> Stichtag = Folgetag.
        await api.buero.speichern('buchhaltung', { ...aktuell, kontostand: saldo.betrag, kontostandDatum: saldo.datum ? plusTage(saldo.datum, 1) : null });
      }
      setZustand('verbucht');
      onVerbucht?.(zuVerbuchen.length);
    } catch (err) { setFehler(err.message); }
  }

  return (
    <div className="modal-hintergrund" {...hintergrundSchliessen(onSchliessen)}>
      <div className="modal modal-mail kontoauszug-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-kopf">
          <span>Kontoauszug einlesen – Zahlungseingänge abgleichen</span>
          <button type="button" className="modal-schliessen" onClick={onSchliessen} aria-label="Schliessen">×</button>
        </div>
        <div className="modal-koerper">
          {(zustand === 'auswahl' || zustand === 'liest') && (
            <div
              className={`beleg-drop ${ziehen ? 'aktiv' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setZiehen(true); }}
              onDragLeave={() => setZiehen(false)}
              onDrop={(e) => { e.preventDefault(); setZiehen(false); einlesen(e.dataTransfer.files); }}
              onClick={() => eingabeRef.current?.click()}
              role="button"
              tabIndex={0}
            >
              <div className="beleg-drop-titel">{zustand === 'liest' ? 'Liest den Kontoauszug…' : 'Kontoauszug hierher ziehen'}</div>
              <div className="beleg-drop-text">camt.053/054 (XML aus dem UBS E-Banking, empfohlen), CSV/Excel-Export oder PDF · mehrere Dateien möglich</div>
              <input ref={eingabeRef} type="file" multiple hidden accept=".xml,.csv,.txt,.xlsx,.pdf" onChange={(e) => { einlesen(e.target.files); e.target.value = ''; }} />
            </div>
          )}

          {zustand === 'pruefen' && (
            <>
              <p className="feld-hinweis">
                {zeilen.length} Zahlungseingänge gefunden{belastungen ? `, ${belastungen} Belastungen übersprungen` : ''}. Zuordnung prüfen, bei Bedarf eine andere Rechnung wählen und verbuchen – die Rechnung gilt dann am Buchungsdatum als bezahlt.
              </p>
              <table className="tabelle kontoauszug-tabelle">
                <thead>
                  <tr><th></th><th>Datum</th><th className="zahl">Betrag</th><th>Von / Text</th><th>Offene Rechnung</th><th>Treffer</th></tr>
                </thead>
                <tbody>
                  {zeilen.map((z, i) => (
                    <tr key={i} className={!z.belegId ? 'kontoauszug-ohne' : ''}>
                      <td><input type="checkbox" checked={z.verbuchen && !!z.belegId} disabled={!z.belegId} onChange={(e) => zeileAendern(i, { verbuchen: e.target.checked })} aria-label="Verbuchen" /></td>
                      <td>{formatiereDatum(z.buchung.datum)}</td>
                      <td className="zahl">{chf(z.buchung.betrag)}</td>
                      <td className="kontoauszug-text">
                        {z.buchung.gegenpartei && <strong>{z.buchung.gegenpartei}</strong>}
                        {z.buchung.text && <div className="text-gedaempft">{z.buchung.text}</div>}
                        {z.buchung.referenz && <div className="text-gedaempft">Ref. {z.buchung.referenz}</div>}
                      </td>
                      <td>
                        <select value={z.belegId} onChange={(e) => zeileAendern(i, { belegId: e.target.value, verbuchen: !!e.target.value, sicherheit: e.target.value ? 'manuell' : null, grund: e.target.value ? 'von Hand gewählt' : 'keine Zuordnung' })}>
                          <option value="">– keine (ignorieren) –</option>
                          {offen.map((d) => (
                            <option key={d.id} value={String(d.id)}>{d.partner} · {d.rechnungsnummer || '–'} · {chf(d.betrag)}</option>
                          ))}
                        </select>
                        {doppelt.has(z.belegId) && <div className="text-ueberfaellig">Diese Rechnung ist mehrfach gewählt.</div>}
                      </td>
                      <td>
                        {z.sicherheit && <span className={`beleg-status kontoauszug-${z.sicherheit}`}>{SICHERHEIT[z.sicherheit] ?? z.sicherheit}</span>}
                        <div className="text-gedaempft">{z.grund}</div>
                      </td>
                    </tr>
                  ))}
                  {zeilen.length === 0 && <tr><td colSpan={6} className="leer-hinweis">Keine Zahlungseingänge im Auszug.</td></tr>}
                </tbody>
              </table>
              {saldo && (
                <label className="kontoauszug-saldo">
                  <input type="checkbox" checked={saldoUebernehmen} onChange={(e) => setSaldoUebernehmen(e.target.checked)} />
                  Schlusssaldo {chf(saldo.betrag)}{saldo.datum ? ` per ${formatiereDatum(saldo.datum)}` : ''} als Kontostand im Liquiditätsplan übernehmen
                </label>
              )}
            </>
          )}

          {zustand === 'verbucht' && (
            <div className="hinweis-erfolg">
              {zuVerbuchen.length} Rechnung(en) als bezahlt verbucht{saldo && saldoUebernehmen ? ', Kontostand übernommen' : ''}.
            </div>
          )}
          {fehler && <div className="hinweis-fehler">{fehler}</div>}
        </div>
        <div className="modal-fuss">
          <div>{zustand === 'pruefen' && <button type="button" className="btn" onClick={() => { setZeilen([]); setZustand('auswahl'); }}>Anderen Auszug</button>}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={onSchliessen}>{zustand === 'verbucht' ? 'Schliessen' : 'Abbrechen'}</button>
            {zustand === 'pruefen' && (
              <button type="button" className="btn btn-primary" onClick={verbuchen} disabled={(!zuVerbuchen.length && !(saldo && saldoUebernehmen)) || doppelt.size > 0}>
                {zuVerbuchen.length} Zahlung{zuVerbuchen.length === 1 ? '' : 'en'} verbuchen
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
