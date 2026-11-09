import { useRef, useState } from 'react';
import api from '../api.js';
import { csvZerlegen, tabelleZaehlen, camtZaehlen, monateZusammen, kennzahlen, xlsxZeilen } from '../lib/buchungsjournal.js';

const MONATSNAME = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const monatText = (m) => `${MONATSNAME[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

// Eine Datei auswerten -> { monate, methode }.
async function dateiAuswerten(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) {
    const r = tabelleZaehlen(await xlsxZeilen(await file.arrayBuffer()));
    if (!r) throw new Error('keine Datumsspalte gefunden');
    return r;
  }
  if (name.endsWith('.xls')) throw new Error('altes Excel-Format – bitte als .xlsx oder .csv speichern');
  if (name.endsWith('.xml')) {
    const r = camtZaehlen(await file.text());
    if (!r) throw new Error('keine Buchungen (camt) gefunden');
    return r;
  }
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const r = await api.buchungenZaehlen(file);
    return { monate: r.monate ?? [], methode: `KI${r.art && r.art !== 'anderes' ? ` (${r.art})` : ''}${r.hinweis ? ` – ${r.hinweis}` : ''}` };
  }
  const r = tabelleZaehlen(csvZerlegen(await file.text()));
  if (!r) throw new Error('keine Datumsspalte gefunden');
  return r;
}

// Preiskalkulation: Buchungsjournal oder Bankauszug hineinziehen, Buchungen pro Monat zaehlen
// und den Monatsdurchschnitt als Menge in eine Beleg-Leistung (z.B. Finanzbuchhaltung) setzen.
export default function BuchungsAnalyse({ leistungen, onUebernehmen }) {
  const [dateien, setDateien] = useState([]); // { name, monate?, methode?, fehler?, laeuft? }
  const [ziehen, setZiehen] = useState(false);
  const belegLeistungen = leistungen.filter((l) => l.aktiv && /beleg/i.test(l.einheit ?? ''));
  const standard = belegLeistungen.find((l) => /finanzbuchhaltung.*standard/i.test(l.name)) ?? belegLeistungen[0];
  const [ziel, setZiel] = useState('');
  const [wert, setWert] = useState('durchschnitt');
  const eingabeRef = useRef(null);

  async function annehmen(files) {
    const liste = [...files].filter((f) => f.size > 0);
    if (!liste.length) return;
    setDateien((alt) => [...alt, ...liste.map((f) => ({ name: f.name, laeuft: true }))]);
    for (const f of liste) {
      let ergebnis;
      try { ergebnis = await dateiAuswerten(f); } catch (err) { ergebnis = { fehler: err.message }; }
      setDateien((alt) => {
        const i = alt.findIndex((d) => d.name === f.name && d.laeuft);
        if (i < 0) return alt;
        const neu = [...alt];
        neu[i] = { name: f.name, ...ergebnis };
        return neu;
      });
    }
  }

  const fertig = dateien.filter((d) => d.monate);
  const k = kennzahlen(monateZusammen(fertig.map((d) => d.monate)));
  const zielId = ziel || String(standard?.id ?? '');
  const zielLeistung = belegLeistungen.find((l) => String(l.id) === zielId);
  const menge = k ? Math.ceil(wert === 'maximum' ? k.maximum : k.durchschnitt) : 0;

  return (
    <div className="buchungs-analyse">
      <div
        className={`beleg-drop buchungs-drop ${ziehen ? 'aktiv' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setZiehen(true); }}
        onDragLeave={() => setZiehen(false)}
        onDrop={(e) => { e.preventDefault(); setZiehen(false); annehmen(e.dataTransfer.files); }}
        onClick={() => eingabeRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') eingabeRef.current?.click(); }}
      >
        <div className="beleg-drop-titel">Buchungsjournal oder Bankauszug hierher ziehen</div>
        <div className="beleg-drop-text">CSV, Excel (.xlsx), camt-XML aus dem E-Banking oder PDF · zählt die Buchungen pro Monat · mehrere Dateien möglich</div>
        <input ref={eingabeRef} type="file" multiple hidden accept=".csv,.txt,.xlsx,.xls,.xml,.pdf" onChange={(e) => { annehmen(e.target.files); e.target.value = ''; }} />
      </div>

      {dateien.length > 0 && (
        <div className="buchungs-ergebnis">
          <ul className="buchungs-dateien">
            {dateien.map((d, i) => (
              <li key={`${d.name}-${i}`}>
                <strong>{d.name}</strong>{' '}
                {d.laeuft && <span className="text-gedaempft">wird ausgewertet…</span>}
                {d.fehler && <span className="text-ueberfaellig">{d.fehler}</span>}
                {d.monate && <span className="text-gedaempft">{d.monate.reduce((s, m) => s + m.anzahl, 0)} Buchungen · {d.methode}</span>}
              </li>
            ))}
          </ul>
          {k && (
            <>
              <div className="buchungs-monate">
                {k.monate.map((m) => (
                  <span key={m.monat} className="buchungs-monat"><span>{monatText(m.monat)}</span><strong>{m.anzahl}</strong></span>
                ))}
              </div>
              <div className="buchungs-kennzahlen">
                <span>Total <strong>{k.total}</strong> in {k.monate.length} Monat{k.monate.length === 1 ? '' : 'en'}</span>
                <span>Ø <strong>{k.durchschnitt}</strong> / Monat</span>
                <span>Maximum <strong>{k.maximum}</strong></span>
              </div>
              <div className="buchungs-uebernahme">
                <select value={wert} onChange={(e) => setWert(e.target.value)} aria-label="Wert">
                  <option value="durchschnitt">Ø pro Monat ({Math.ceil(k.durchschnitt)})</option>
                  <option value="maximum">Maximum ({k.maximum})</option>
                </select>
                <span>als Menge in</span>
                <select value={zielId} onChange={(e) => setZiel(e.target.value)} aria-label="Leistung">
                  {belegLeistungen.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <button type="button" className="btn btn-primary" disabled={!zielLeistung || !menge} onClick={() => onUebernehmen(zielLeistung, menge)}>
                  {menge} Belege übernehmen
                </button>
                <button type="button" className="btn-klein" onClick={() => setDateien([])}>Zurücksetzen</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
