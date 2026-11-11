import { useEffect, useState } from 'react';
import api from '../api.js';
import { chf } from '../lib/offerte.js';
import { formatiereDatum, heutigesDatumISO } from '../format.js';
import { zahlungPruefen, zahlungHinweise, pain001, ibanGueltig, kompakt } from '../lib/pain001.js';
import { herunterladen } from '../lib/ablageOrdner.js';
import { hintergrundSchliessen } from '../lib/modal.js';

// Naechster Bankwerktag ab einem Datum (Sa/So -> Montag).
function bankwerktag(iso) {
  const [j, m, d] = iso.split('-').map(Number);
  const datum = new Date(Date.UTC(j, m - 1, d));
  const tag = datum.getUTCDay();
  if (tag === 6) datum.setUTCDate(datum.getUTCDate() + 2);
  if (tag === 0) datum.setUTCDate(datum.getUTCDate() + 1);
  return datum.toISOString().slice(0, 10);
}

function morgen(iso) {
  const [j, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, d + 1)).toISOString().slice(0, 10);
}

function zeitstempel() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return {
    iso: `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`,
    kurz: `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`,
  };
}

// Zahlungslauf aus den gewaehlten Kreditorenbelegen: pruefen, Belastungskonto, Datum,
// pain.001-Datei herunterladen und den Lauf speichern.
export default function ZahlungslaufModal({ belege, onSchliessen, onErstellt }) {
  const [konto, setKonto] = useState(null);
  // Valuta: immer der naechste Bankwerktag nach heute (Fr -> Mo).
  const [datum, setDatum] = useState(() => bankwerktag(morgen(heutigesDatumISO())));
  const [fehler, setFehler] = useState(null);
  const [beschaeftigt, setBeschaeftigt] = useState(false);

  useEffect(() => {
    Promise.all([api.buero.lesen('buchhaltung'), api.buero.lesen('firma')]).then(([b, f]) => setKonto({
      auftraggeber: b.auftraggeber || f.firma || '', iban: b.zahlungskontoIban || '', bic: b.zahlungskontoBic ?? 'UBSWCHZH80A',
    })).catch((e) => setFehler(e.message));
  }, []);

  useEffect(() => {
    function onKeyDown(e) { if (e.key === 'Escape') onSchliessen(); }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSchliessen]);

  if (!konto) return null;
  const pruefungen = belege.map((b) => ({ b, fehler: zahlungPruefen(b), hinweise: zahlungHinweise(b) }));
  const fehlerhaft = pruefungen.filter((p) => p.fehler.length);
  const summe = belege.filter((b) => (b.waehrung || 'CHF') === 'CHF').reduce((s, b) => s + Number(b.betrag || 0), 0);
  const kontoFehler = !konto.auftraggeber.trim() ? 'Auftraggeber fehlt' : !ibanGueltig(konto.iban) ? 'IBAN des Belastungskontos fehlt oder ist ungültig' : null;
  const datumFehler = !datum || datum < heutigesDatumISO() ? 'Ausführungsdatum muss heute oder später sein' : null;

  async function erstellen() {
    setBeschaeftigt(true);
    setFehler(null);
    try {
      const aktuell = await api.buero.lesen('buchhaltung');
      await api.buero.speichern('buchhaltung', { ...aktuell, auftraggeber: konto.auftraggeber.trim(), zahlungskontoIban: kompakt(konto.iban), zahlungskontoBic: kompakt(konto.bic) });
      const zeit = zeitstempel();
      const msgId = `AM-${zeit.kurz}`;
      const xml = pain001({ msgId, erstelltAm: zeit.iso, ausfuehrungsdatum: datum, auftraggeber: konto.auftraggeber.trim(), iban: konto.iban, bic: konto.bic }, belege);
      const dateiname = `Zahlungslauf_${datum}_${zeit.kurz.slice(8, 12)}.xml`;
      await api.zahlungslaeufe.erstellen({ ausfuehrungsdatum: datum, msgId, dateiname, xml, belege });
      herunterladen(new Blob([xml], { type: 'application/xml' }), dateiname);
      onErstellt?.(dateiname);
    } catch (err) {
      setFehler(err.message);
      setBeschaeftigt(false);
    }
  }

  return (
    <div className="modal-hintergrund" {...hintergrundSchliessen(onSchliessen)}>
      <div className="modal modal-mittel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-kopf">
          <span>Zahlungslauf erstellen · {belege.length} Zahlung{belege.length === 1 ? '' : 'en'}</span>
          <button type="button" className="modal-schliessen" onClick={onSchliessen} aria-label="Schliessen">×</button>
        </div>
        <div className="modal-koerper">
          <table className="tabelle zahlungslauf-tabelle">
            <thead><tr><th>Kreditor</th><th>Fällig</th><th className="zahl">Betrag</th><th>Prüfung</th></tr></thead>
            <tbody>
              {pruefungen.map(({ b, fehler: f, hinweise: h }) => (
                <tr key={b.id}>
                  <td><strong>{b.partner}</strong>{b.rechnungsnummer ? <span className="text-gedaempft"> · {b.rechnungsnummer}</span> : null}</td>
                  <td>{b.faelligkeit ? formatiereDatum(b.faelligkeit) : '–'}</td>
                  <td className="zahl">{(b.waehrung || 'CHF') !== 'CHF' ? `${b.waehrung} ` : ''}{chf(b.betrag)}</td>
                  <td>{f.length ? <span className="text-ueberfaellig">{f.join(' · ')}</span> : <><span className="beleg-status beleg-status-bezahlt">bereit</span>{h.length > 0 && <span className="text-gedaempft"> · {h.join(' · ')}</span>}</>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={2}>Total CHF</td><td className="zahl"><strong>{chf(summe)}</strong></td><td /></tr></tfoot>
          </table>
          {fehlerhaft.length > 0 && (
            <div className="hinweis-fehler">
              {fehlerhaft.length} Beleg(e) unvollständig – im Beleg ergänzen (IBAN, Referenz, Betrag) oder aus der Auswahl nehmen.
            </div>
          )}

          <div className="feld-gruppe-titel">Belastungskonto</div>
          <div className="feld">
            <label htmlFor="zl-auftraggeber">Auftraggeber</label>
            <input id="zl-auftraggeber" value={konto.auftraggeber} onChange={(e) => setKonto((k) => ({ ...k, auftraggeber: e.target.value }))} />
          </div>
          <div className="feld-reihe">
            <div className="feld">
              <label htmlFor="zl-iban">IBAN (UBS-Konto)</label>
              <input id="zl-iban" value={konto.iban} onChange={(e) => setKonto((k) => ({ ...k, iban: e.target.value }))} placeholder="CH.. .... .... .... .... ." />
            </div>
            <div className="feld">
              <label htmlFor="zl-bic">BIC der Bank</label>
              <input id="zl-bic" value={konto.bic} onChange={(e) => setKonto((k) => ({ ...k, bic: e.target.value }))} />
            </div>
          </div>
          <div className="feld">
            <label htmlFor="zl-datum">Ausführungsdatum (Valuta)</label>
            <input id="zl-datum" type="date" value={datum} onChange={(e) => setDatum(e.target.value)} />
          </div>
          <p className="feld-hinweis">
            Erstellt eine Datei im Format pain.001 (Swiss Payment Standards). Im UBS E-Banking unter Zahlungen die Datei hochladen und den Auftrag freigeben.
            Die Belege stehen danach auf «im Zahlungslauf»; nach der Ausführung unten bei den Zahlungsläufen «bezahlt» klicken.
          </p>
          {(kontoFehler || datumFehler) && <div className="hinweis-fehler">{kontoFehler || datumFehler}</div>}
          {fehler && <div className="hinweis-fehler">{fehler}</div>}
        </div>
        <div className="modal-fuss">
          <div />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={onSchliessen}>Abbrechen</button>
            <button type="button" className="btn btn-primary" onClick={erstellen} disabled={beschaeftigt || fehlerhaft.length > 0 || !!kontoFehler || !!datumFehler}>
              {beschaeftigt ? 'Erstellt…' : 'Datei erstellen'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
