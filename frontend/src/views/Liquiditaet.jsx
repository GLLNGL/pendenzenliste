import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api.js';
import { formatiereDatum, heutigesDatumISO } from '../format.js';
import { chf } from '../lib/offerte.js';
import { liquiditaetsplan, durchschnittFrist, belegStatus } from '../lib/liquiditaet.js';

// Modul Buchhaltung › Liquiditaetsplan: Kontostand + offene Debitoren - offene Kreditoren nach
// Faelligkeit, pro Woche oder Monat, dazu der Vergleich der Zahlungsfristen.
export default function Liquiditaet() {
  const [belege, setBelege] = useState(null);
  const [einstellungen, setEinstellungen] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [einheit, setEinheit] = useState('woche');
  const [stand, setStand] = useState({ betrag: '', datum: '' });
  const [gespeichert, setGespeichert] = useState(false);
  const heute = heutigesDatumISO();

  useEffect(() => {
    api.belege.liste().then(setBelege).catch((e) => { setBelege([]); setFehler(e.message); });
    api.buero.lesen('buchhaltung').then((w) => {
      setEinstellungen(w);
      setStand({ betrag: w.kontostand ?? '', datum: w.kontostandDatum ?? '' });
    }).catch(() => setEinstellungen({}));
  }, []);

  async function standSpeichern(e) {
    e.preventDefault();
    try {
      const aktuell = await api.buero.lesen('buchhaltung');
      const neu = { ...aktuell, kontostand: stand.betrag === '' ? null : Number(stand.betrag), kontostandDatum: stand.datum || heute };
      await api.buero.speichern('buchhaltung', neu);
      setEinstellungen(neu);
      setStand((s) => ({ ...s, datum: neu.kontostandDatum }));
      setGespeichert(true);
      setTimeout(() => setGespeichert(false), 2000);
    } catch (err) { setFehler(err.message); }
  }

  if (!belege || !einstellungen) return null;
  if (fehler && /schema cache|does not exist|relation/i.test(fehler)) {
    return <div className="hinweis-fehler">Buchhaltung noch nicht eingerichtet – bitte zuerst <code>supabase/buchhaltung-v7.sql</code> in Supabase ausführen.</div>;
  }

  const start = Number(stand.betrag) || 0;
  const plan = liquiditaetsplan(belege, { heute, start, perioden: einheit === 'woche' ? 13 : 6, einheit, kontostandDatum: stand.datum || null });
  const debitoren = belege.filter((b) => b.art === 'debitor');
  const kreditoren = belege.filter((b) => b.art === 'kreditor');
  const offenSumme = (liste) => liste.filter((b) => !b.bezahlt_am && (b.waehrung || 'CHF') === 'CHF').reduce((s, b) => s + Number(b.betrag || 0), 0);
  const fristDeb = durchschnittFrist(debitoren);
  const fristKred = durchschnittFrist(kreditoren);
  const ueberfaelligeDeb = debitoren.filter((b) => belegStatus(b, heute) === 'ueberfaellig');
  const engpass = plan.zeilen.find((z) => z.stand < 0);

  let fristText = 'Noch zu wenige Belege mit Rechnungsdatum und Fälligkeit für einen Vergleich.';
  if (fristDeb != null && fristKred != null) {
    const diff = fristDeb - fristKred;
    fristText = diff > 0
      ? `Deine Kunden haben im Schnitt ${diff} Tage länger Zeit zum Zahlen als du – diese Lücke musst du aus eigener Liquidität überbrücken.`
      : diff < 0
        ? `Deine Kunden zahlen im Schnitt ${-diff} Tage früher, als du deine Lieferanten bezahlen musst – das entlastet die Liquidität.`
        : 'Debitoren- und Kreditorenfristen sind im Schnitt gleich lang.';
  }

  return (
    <div className="liquiditaet">
      <div className="cockpit-kopfzeile">
        <h1 className="seiten-titel">Liquiditätsplan</h1>
        <span className="cockpit-kopf-hinweis">Kontostand + offene Debitoren − offene Kreditoren nach Fälligkeit; bezahlte Rechnungen nach Zahlungsdatum (CHF).</span>
        <span className="kopfzeile-aktionen mandanten-filter">
          <button type="button" className={`mandanten-filter-knopf ${einheit === 'woche' ? 'aktiv' : ''}`} onClick={() => setEinheit('woche')}>Wochen</button>
          <button type="button" className={`mandanten-filter-knopf ${einheit === 'monat' ? 'aktiv' : ''}`} onClick={() => setEinheit('monat')}>Monate</button>
        </span>
      </div>

      <div className="liq-kacheln">
        <form className="liq-kachel" onSubmit={standSpeichern}>
          <div className="liq-kachel-titel">Kontostand</div>
          <div className="liq-stand-eingabe">
            <input type="number" step="0.01" value={stand.betrag} onChange={(e) => setStand((s) => ({ ...s, betrag: e.target.value }))} placeholder="CHF" aria-label="Kontostand CHF" />
            <input type="date" value={stand.datum} onChange={(e) => setStand((s) => ({ ...s, datum: e.target.value }))} aria-label="Stand per" />
            <button type="submit" className="btn-klein">{gespeichert ? '✓' : 'Speichern'}</button>
          </div>
          <div className="liq-kachel-text">{einstellungen.kontostandDatum ? `Stand per ${formatiereDatum(einstellungen.kontostandDatum)}` : 'Aktuellen Bankstand eintragen.'}</div>
        </form>
        <div className="liq-kachel">
          <div className="liq-kachel-titel">Offene Debitoren</div>
          <div className="liq-kachel-zahl liq-plus">{chf(offenSumme(debitoren))}</div>
          <div className="liq-kachel-text">{ueberfaelligeDeb.length ? <span className="text-ueberfaellig">{ueberfaelligeDeb.length} überfällig – nachfassen</span> : <Link to="/debitoren">Debitoren</Link>}</div>
        </div>
        <div className="liq-kachel">
          <div className="liq-kachel-titel">Offene Kreditoren</div>
          <div className="liq-kachel-zahl liq-minus">{chf(offenSumme(kreditoren))}</div>
          <div className="liq-kachel-text"><Link to="/kreditoren">Kreditoren</Link></div>
        </div>
        <div className={`liq-kachel ${plan.tiefsterStand < 0 ? 'liq-warnung' : ''}`}>
          <div className="liq-kachel-titel">Tiefster Stand im Plan</div>
          <div className={`liq-kachel-zahl ${plan.tiefsterStand < 0 ? 'liq-minus' : ''}`}>{chf(plan.tiefsterStand)}</div>
          <div className="liq-kachel-text">{engpass ? `Engpass ab ${engpass.label}` : 'Kein Engpass im Planungszeitraum.'}</div>
        </div>
        <div className="liq-kachel liq-kachel-breit">
          <div className="liq-kachel-titel">Zahlungsfristen im Vergleich</div>
          <div className="liq-fristen">
            <span>Debitoren Ø <strong>{fristDeb ?? '–'} Tage</strong></span>
            <span>Kreditoren Ø <strong>{fristKred ?? '–'} Tage</strong></span>
          </div>
          <div className="liq-kachel-text">{fristText}</div>
        </div>
      </div>

      <div className="karte">
        <table className="tabelle liq-tabelle">
          <thead>
            <tr><th>Periode</th><th className="zahl">Zuflüsse (Debitoren)</th><th className="zahl">Abflüsse (Kreditoren)</th><th className="zahl">Saldo</th><th className="zahl">Stand</th><th className="liq-balken-spalte"></th></tr>
          </thead>
          <tbody>
            <tr className="liq-startzeile">
              <td>Kontostand {stand.datum ? `per ${formatiereDatum(stand.datum)}` : ''}</td><td /><td /><td />
              <td className="zahl"><strong>{chf(start)}</strong></td><td />
            </tr>
            {plan.bezahltSeitStand.anzahl > 0 && (
              <tr className="liq-bezahlt">
                <td>Bezahlt seit dem Kontostand ({plan.bezahltSeitStand.anzahl})</td>
                <td className="zahl liq-plus">{plan.bezahltSeitStand.zufluss ? chf(plan.bezahltSeitStand.zufluss) : ''}</td>
                <td className="zahl liq-minus">{plan.bezahltSeitStand.abfluss ? chf(plan.bezahltSeitStand.abfluss) : ''}</td>
                <td className="zahl">{chf(plan.bezahltSeitStand.zufluss - plan.bezahltSeitStand.abfluss)}</td>
                <td className={`zahl ${plan.standNachBezahlt < 0 ? 'liq-minus' : ''}`}>{chf(plan.standNachBezahlt)}</td>
                <td />
              </tr>
            )}
            {(plan.ueberfaellig.zufluss > 0 || plan.ueberfaellig.abfluss > 0) && (
              <tr className="liq-ueberfaellig">
                <td>Überfällig (sofort)</td>
                <td className="zahl liq-plus">{plan.ueberfaellig.zufluss ? chf(plan.ueberfaellig.zufluss) : ''}</td>
                <td className="zahl liq-minus">{plan.ueberfaellig.abfluss ? chf(plan.ueberfaellig.abfluss) : ''}</td>
                <td className="zahl">{chf(plan.ueberfaellig.zufluss - plan.ueberfaellig.abfluss)}</td>
                <td className={`zahl ${plan.standNachUeberfaellig < 0 ? 'liq-minus' : ''}`}>{chf(plan.standNachUeberfaellig)}</td>
                <td />
              </tr>
            )}
            {plan.zeilen.map((z) => {
              const max = Math.max(1, ...plan.zeilen.map((x) => Math.abs(x.stand)), Math.abs(plan.standNachUeberfaellig));
              return (
                <tr key={z.von} className={z.stand < 0 ? 'liq-negativ' : ''}>
                  <td>{z.label}</td>
                  <td className="zahl liq-plus">{z.zufluss ? chf(z.zufluss) : ''}</td>
                  <td className="zahl liq-minus">{z.abfluss ? chf(z.abfluss) : ''}</td>
                  <td className="zahl">{z.saldo ? chf(z.saldo) : ''}</td>
                  <td className={`zahl ${z.stand < 0 ? 'liq-minus' : ''}`}><strong>{chf(z.stand)}</strong></td>
                  <td className="liq-balken-spalte"><div className={`liq-balken ${z.stand < 0 ? 'negativ' : ''}`} style={{ width: `${Math.round((Math.abs(z.stand) / max) * 100)}%` }} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="liq-fuss">
          {plan.spaeter !== 0 && <span>Später fällig (nach dem Plan): {chf(plan.spaeter)}</span>}
          {plan.ohneDatum !== 0 && <span>Ohne Fälligkeit: {chf(plan.ohneDatum)}</span>}
          {plan.fremdwaehrung.length > 0 && <span>{plan.fremdwaehrung.length} offene Beleg(e) in Fremdwährung sind nicht eingerechnet.</span>}
        </div>
      </div>
    </div>
  );
}
