import { forwardRef } from 'react';
import { dokumentZeilen, totale, textErsetzen, chf } from '../lib/offerte.js';
import { formatiereDatum } from '../format.js';

const LOGO = `${import.meta.env.BASE_URL}logo-est-controlling.png`;

function menge(z) {
  if (z === '' || z == null) return '';
  return Number(z).toLocaleString('de-CH', { maximumFractionDigits: 2 });
}

// Die Offerte als A4-Seite im Layout des bisherigen Excel-Blatts "Angebot". Wird in der
// Vorschau, beim Drucken und fuer das PDF (E-Mail-Anhang) identisch verwendet.
const OffertDokument = forwardRef(function OffertDokument({ offerte, positionen, mandant, bearbeiter, firma, texte }, ref) {
  const { leistungen, lizenzen } = dokumentZeilen(positionen);
  const t = totale(positionen, offerte);
  const gueltigBis = formatiereDatum(offerte.gueltig_bis);
  const konditionen = [...(texte.konditionen || [])];
  if (Number(offerte.skonto_prozent) > 0) {
    konditionen.push(`Bei Zahlung innert ${offerte.skonto_tage || 10} Tagen gewähren wir ${menge(offerte.skonto_prozent)} % Skonto.`);
  }
  konditionen.push(`Dieses Angebot ist gültig bis ${gueltigBis}.`);
  const absender = [firma.firma, firma.strasse, firma.plzOrt].filter(Boolean).join('  •  ');
  const plzOrt = [mandant?.plz, mandant?.ort].filter(Boolean).join(' ');

  const zeile = (z) => (
    <tr key={z.pos}>
      <td className="od-pos">{z.pos}</td>
      <td>{z.bezeichnung}</td>
      <td className="od-zahl">{menge(z.menge)}</td>
      <td>{z.einheit}</td>
      <td className="od-zahl">{z.ePreis == null ? '' : chf(z.ePreis)}</td>
      <td className="od-zahl">{chf(z.gPreis)}</td>
    </tr>
  );

  return (
    <div className="offerte-dokument" ref={ref}>
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
            <tr><td>Angebot-Nr.</td><td>{offerte.nummer}</td></tr>
            <tr><td>Datum</td><td>{formatiereDatum(offerte.datum)}</td></tr>
            <tr><td>Gültig bis</td><td>{gueltigBis}</td></tr>
            {mandant?.kunden_nr && <tr><td>Kunden-Nr.</td><td>{mandant.kunden_nr}</td></tr>}
            {bearbeiter && <tr><td>Bearbeiter</td><td>{bearbeiter}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="od-titel">Angebot</div>
      {firma.untertitel && <div className="od-untertitel">{firma.untertitel}</div>}

      <table className="od-positionen">
        <thead>
          <tr><th className="od-pos">Pos.</th><th>Bezeichnung</th><th className="od-zahl">Menge</th><th>Einh.</th><th className="od-zahl">E-Preis CHF</th><th className="od-zahl">G-Preis CHF</th></tr>
        </thead>
        <tbody>
          {leistungen.map(zeile)}
          {leistungen.length === 0 && <tr><td colSpan={6} className="od-leer">Noch keine Dienstleistungen.</td></tr>}
        </tbody>
      </table>

      {lizenzen.length > 0 && (
        <>
          <div className="od-zwischentitel">ABACUS-Lizenzen</div>
          <table className="od-positionen od-ohne-kopf">
            <tbody>{lizenzen.map(zeile)}</tbody>
          </table>
        </>
      )}

      <table className="od-totale">
        <tbody>
          <tr className="od-fett od-linie-dick"><td>Netto (exkl. MWST)</td><td className="od-zahl">{chf(t.netto)}</td></tr>
          {t.rabatt > 0 && <tr><td>Rabatt ({menge(offerte.rabatt_prozent)}%)</td><td className="od-zahl">{chf(-t.rabatt)}</td></tr>}
          {t.rabatt > 0 && <tr className="od-fett od-linie"><td>Netto nach Rabatt (exkl. MWST)</td><td className="od-zahl">{chf(t.nettoNachRabatt)}</td></tr>}
          <tr>
            <td>{offerte.mwst_pflichtig ? `zzgl. MWST (${menge(offerte.mwst_satz)}%)` : 'MWST nicht anwendbar (nicht MWST-pflichtig)'}</td>
            <td className="od-zahl">{chf(t.mwst)}</td>
          </tr>
          <tr className="od-fett od-linie od-total"><td>Total inkl. MWST</td><td className="od-zahl">{chf(t.total)}</td></tr>
        </tbody>
      </table>

      <div className="od-konditionen-titel">Konditionen</div>
      <ul className="od-konditionen">
        {konditionen.map((k) => <li key={k}>{textErsetzen(k, { gueltigBis })}</li>)}
      </ul>

      {texte.schlusssatz && <p className="od-schluss">{texte.schlusssatz}</p>}

      <div className="od-unterschriften">
        <div>Ort, Datum</div>
        <div>Unterschrift</div>
      </div>

      <div className="od-fuss">{[firma.firma, firma.slogan].filter(Boolean).join('  |  ')}</div>
    </div>
  );
});

export default OffertDokument;
