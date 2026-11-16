import { forwardRef } from 'react';
import { formatiereDatum } from '../format.js';
import { chf } from '../lib/offerte.js';
import { ibanAnzeige, referenzAnzeige } from '../lib/qrrechnung.js';

const LOGO = `${import.meta.env.BASE_URL}logo-est-controlling.png`;
const b = (x) => chf(x).replace('CHF ', '');

function Adresse({ a }) {
  if (!a) return null;
  return <>{a.name}<br />{[a.strasse, a.nr].filter(Boolean).join(' ')}<br />{a.plz} {a.ort}</>;
}

// Swiss QR-Code mit Schweizerkreuz (46 x 46 mm, Kreuz 7 x 7 mm).
function QrCode({ src }) {
  return (
    <div className="qr-code">
      {src ? <img src={src} alt="Swiss QR Code" /> : <div className="qr-platzhalter">QR-Code</div>}
      <svg className="qr-kreuz" viewBox="0 0 19.8 19.8" aria-hidden="true">
        <rect width="19.8" height="19.8" fill="#fff" />
        <rect x="1.4" y="1.4" width="17" height="17" fill="#000" />
        <rect x="8.3" y="4.4" width="3.3" height="11" fill="#fff" />
        <rect x="4.4" y="8.3" width="11" height="3.3" fill="#fff" />
      </svg>
    </div>
  );
}

// Rechnung (A4) mit Zahlteil unten (210 x 105 mm): Empfangsschein links, Zahlteil rechts.
const RechnungDokument = forwardRef(function RechnungDokument({ kopf, positionen, summen, kreditor, debitor, mandant, zahlung, qrSrc, firma, texte }, ref) {
  const absender = [firma.firma, firma.strasse, firma.plzOrt].filter(Boolean).join('  •  ');
  return (
    <div className="offerte-dokument rechnung-dokument" ref={ref}>
      <div className="od-kopf">
        <div className="od-absender">{absender}</div>
        <img className="od-logo" src={LOGO} alt={firma.firma || 'Logo'} />
      </div>
      <div className="od-adressblock">
        <div className="od-empfaenger">
          <div className="od-empfaenger-firma">{mandant?.name}</div>
          {mandant?.ansprechperson && <div>{mandant.ansprechperson}</div>}
          {mandant?.strasse && <div>{mandant.strasse}</div>}
          {(mandant?.plz || mandant?.ort) && <div>{[mandant.plz, mandant.ort].filter(Boolean).join(' ')}</div>}
        </div>
        <table className="od-info">
          <tbody>
            <tr><td>Rechnung-Nr.</td><td>{kopf.nummer}</td></tr>
            <tr><td>Datum</td><td>{formatiereDatum(kopf.datum)}</td></tr>
            <tr><td>Zahlbar bis</td><td>{formatiereDatum(kopf.faellig)}</td></tr>
            {mandant?.kunden_nr && <tr><td>Kunden-Nr.</td><td>{mandant.kunden_nr}</td></tr>}
            {firma.mwstNr && <tr><td>MWST-Nr.</td><td>{firma.mwstNr}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="od-titel">Rechnung</div>
      {texte?.einleitung && <p className="rd-text">{texte.einleitung}</p>}
      <table className="re-positionen">
        <thead><tr><th>Bezeichnung</th><th className="od-zahl">Std.</th><th className="od-zahl">Ansatz CHF</th><th className="od-zahl">Betrag CHF</th></tr></thead>
        <tbody>
          {positionen.map((p, i) => (
            <tr key={i}><td>{p.text}</td><td className="od-zahl">{p.stunden.toFixed(2)}</td><td className="od-zahl">{b(p.ansatz)}</td><td className="od-zahl">{b(p.betrag)}</td></tr>
          ))}
        </tbody>
      </table>
      <table className="od-totale re-totale">
        <tbody>
          <tr><td>Total exkl. MWST</td><td className="od-zahl">{b(summen.betragExtra)}</td></tr>
          {summen.mwst > 0 && <tr><td>MWST {kopf.mwstSatz} %</td><td className="od-zahl">{b(summen.mwst)}</td></tr>}
          <tr className="od-fett od-linie-dick od-total"><td>Total CHF</td><td className="od-zahl">{b(summen.total)}</td></tr>
        </tbody>
      </table>
      <p className="re-hinweis">{texte?.zahlungstext || `Zahlbar innert ${kopf.fristTage} Tagen mit dem untenstehenden QR-Einzahlungsschein.`} Der Detailrapport liegt bei.</p>

      <div className="qr-zahlteil">
        <div className="qr-schere">Vor der Einzahlung abzutrennen</div>
        <div className="qr-empfangsschein">
          <div className="qr-titel">Empfangsschein</div>
          <div className="qr-ueber">Konto / Zahlbar an</div>
          <div className="qr-wert">{ibanAnzeige(zahlung.iban)}<br /><Adresse a={kreditor} /></div>
          {zahlung.referenz && <><div className="qr-ueber">Referenz</div><div className="qr-wert">{referenzAnzeige(zahlung.referenz, zahlung.referenzTyp)}</div></>}
          <div className="qr-ueber">Zahlbar durch</div>
          <div className="qr-wert"><Adresse a={debitor} /></div>
          <div className="qr-betrag-zeile"><div><div className="qr-ueber">Währung</div><div className="qr-wert">CHF</div></div><div><div className="qr-ueber">Betrag</div><div className="qr-wert">{b(summen.total).replace(/'/g, ' ')}</div></div></div>
          <div className="qr-annahme">Annahmestelle</div>
        </div>
        <div className="qr-zahlteil-rechts">
          <div className="qr-links">
            <div className="qr-titel">Zahlteil</div>
            <QrCode src={qrSrc} />
            <div className="qr-betrag-zeile"><div><div className="qr-ueber-gross">Währung</div><div className="qr-wert-gross">CHF</div></div><div><div className="qr-ueber-gross">Betrag</div><div className="qr-wert-gross">{b(summen.total).replace(/'/g, ' ')}</div></div></div>
          </div>
          <div className="qr-angaben">
            <div className="qr-ueber-gross">Konto / Zahlbar an</div>
            <div className="qr-wert-gross">{ibanAnzeige(zahlung.iban)}<br /><Adresse a={kreditor} /></div>
            {zahlung.referenz && <><div className="qr-ueber-gross">Referenz</div><div className="qr-wert-gross">{referenzAnzeige(zahlung.referenz, zahlung.referenzTyp)}</div></>}
            {zahlung.mitteilung && <><div className="qr-ueber-gross">Zusätzliche Informationen</div><div className="qr-wert-gross">{zahlung.mitteilung}</div></>}
            <div className="qr-ueber-gross">Zahlbar durch</div>
            <div className="qr-wert-gross"><Adresse a={debitor} /></div>
          </div>
        </div>
      </div>
    </div>
  );
});

export default RechnungDokument;
