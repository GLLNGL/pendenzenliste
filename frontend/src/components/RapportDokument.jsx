import { forwardRef } from 'react';
import { formatiereDatum } from '../format.js';
import { chf } from '../lib/offerte.js';
import { stundenText } from '../lib/rapport.js';

const LOGO = `${import.meta.env.BASE_URL}logo-est-controlling.png`;

// Detailrapport als A4-Seite(n), im gleichen Erscheinungsbild wie die Offerte. Vorschau, Druck
// und PDF verwenden dieses Dokument.
const RapportDokument = forwardRef(function RapportDokument({ kopf, daten, mandant, bearbeiter, firma, texte }, ref) {
  const absender = [firma.firma, firma.strasse, firma.plzOrt].filter(Boolean).join('  •  ');
  const plzOrt = [mandant?.plz, mandant?.ort].filter(Boolean).join(' ');
  const { pauschal, extra, pauschalProLeistung, summen } = daten;

  return (
    <div className="offerte-dokument rapport-dokument" ref={ref}>
      <div className="od-kopf">
        <div className="od-absender">{absender}</div>
        <img className="od-logo" src={LOGO} alt={firma.firma || 'Logo'} />
      </div>

      <div className="od-adressblock">
        <div className="od-empfaenger">
          <div className="od-empfaenger-firma">{mandant?.name}</div>
          {mandant?.ansprechperson && <div>{mandant.ansprechperson}</div>}
          {mandant?.strasse && <div>{mandant.strasse}</div>}
          {plzOrt && <div>{plzOrt}</div>}
        </div>
        <table className="od-info">
          <tbody>
            <tr><td>Rapport-Nr.</td><td>{kopf.nummer}</td></tr>
            <tr><td>Datum</td><td>{formatiereDatum(kopf.datum)}</td></tr>
            <tr><td>Zeitraum</td><td>{formatiereDatum(kopf.von)} – {formatiereDatum(kopf.bis)}</td></tr>
            {mandant?.kunden_nr && <tr><td>Kunden-Nr.</td><td>{mandant.kunden_nr}</td></tr>}
            {kopf.rechnung_nr && <tr><td>Rechnung</td><td>{kopf.rechnung_nr}</td></tr>}
            {bearbeiter && <tr><td>Bearbeiter</td><td>{bearbeiter}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="od-titel">Detailrapport</div>
      {firma.untertitel && <div className="od-untertitel">{firma.untertitel}</div>}
      {texte.einleitung && <p className="rd-text">{texte.einleitung}</p>}

      <div className="od-zwischentitel rd-abschnitt">Arbeiten in der Pauschale</div>
      {texte.hinweisPauschale && <p className="rd-hinweis">{texte.hinweisPauschale}</p>}
      <table className="od-positionen rd-tabelle">
        <thead><tr><th className="rd-datum">Datum</th><th>Tätigkeit</th><th className="rd-leistung">Leistung</th><th className="od-zahl rd-zeit">Zeit</th></tr></thead>
        <tbody>
          {pauschal.map((z) => (
            <tr key={z.id}><td>{formatiereDatum(z.datum)}</td><td>{z.text}</td><td>{z.leistung}</td><td className="od-zahl">{stundenText(z.minuten)}</td></tr>
          ))}
          {pauschal.length === 0 && <tr><td colSpan={4} className="od-leer">Keine Arbeiten in diesem Zeitraum.</td></tr>}
        </tbody>
      </table>
      {pauschalProLeistung.length > 1 && (
        <table className="od-totale rd-uebersicht">
          <tbody>
            {pauschalProLeistung.map((p) => <tr key={p.leistung}><td>{p.leistung}</td><td className="od-zahl">{stundenText(p.minuten)}</td></tr>)}
          </tbody>
        </table>
      )}
      <table className="od-totale rd-summe">
        <tbody><tr className="od-fett od-linie-dick"><td>Total Arbeiten in der Pauschale</td><td className="od-zahl">{stundenText(summen.minutenPauschal)}</td></tr></tbody>
      </table>

      {extra.length > 0 && (
        <>
          <div className="od-zwischentitel rd-abschnitt">Zusätzliche Arbeiten</div>
          {texte.hinweisExtra && <p className="rd-hinweis">{texte.hinweisExtra}</p>}
          <table className="od-positionen rd-tabelle">
            <thead><tr><th className="rd-datum">Datum</th><th>Tätigkeit</th><th className="od-zahl rd-zeit">Zeit</th><th className="od-zahl rd-ansatz">Ansatz CHF</th><th className="od-zahl rd-betrag">Betrag CHF</th></tr></thead>
            <tbody>
              {extra.map((z) => (
                <tr key={z.id}>
                  <td>{formatiereDatum(z.datum)}</td><td>{z.text}</td><td className="od-zahl">{stundenText(z.minuten)}</td>
                  <td className="od-zahl">{chf(z.ansatz).replace('CHF ', '')}</td><td className="od-zahl">{chf(z.betrag).replace('CHF ', '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="od-totale rd-summe">
            <tbody>
              <tr className="od-fett od-linie-dick"><td>Total zusätzliche Arbeiten (exkl. MWST)</td><td className="od-zahl">{stundenText(summen.minutenExtra)}</td><td className="od-zahl rd-betrag">{chf(summen.betragExtra)}</td></tr>
              <tr>
                <td>{kopf.mwst_pflichtig ? `zzgl. MWST (${Number(kopf.mwst_satz).toLocaleString('de-CH')}%)` : 'MWST nicht anwendbar'}</td>
                <td></td><td className="od-zahl">{chf(summen.mwst)}</td>
              </tr>
              <tr className="od-fett od-linie od-total"><td>Total zusätzliche Arbeiten inkl. MWST</td><td></td><td className="od-zahl">{chf(summen.total)}</td></tr>
            </tbody>
          </table>
        </>
      )}

      {kopf.bemerkung && <p className="rd-text rd-bemerkung">{kopf.bemerkung}</p>}
      {texte.schlusssatz && <p className="od-schluss">{texte.schlusssatz}</p>}
      <div className="od-fuss">{[firma.firma, firma.slogan].filter(Boolean).join('  |  ')}</div>
    </div>
  );
});

export default RapportDokument;
