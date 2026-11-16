// QR-Rechnung (v7): Rechnung fuer Extra-Arbeit mit Swiss QR-Zahlteil (Swiss Payment Standards,
// QR-Rechnung 2.3: strukturierte Adressen "S"). Reine Funktionen mit Tests; der QR-Code selbst
// wird in der Ansicht aus zahlteilText() erzeugt.
import { adresseZerlegen, istQrIban, kompakt, qrReferenzGueltig } from './pain001.js';

const TABELLE = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];

// Pruefziffer Modulo 10 rekursiv (QR-Referenz / ESR).
function mod10(ziffern) {
  let uebertrag = 0;
  for (const z of ziffern) uebertrag = TABELLE[(uebertrag + Number(z)) % 10];
  return String((10 - uebertrag) % 10);
}

// QR-Referenz (27 Ziffern) aus Kunden-Nr. und Rechnungs-Nr. (nur deren Ziffern).
function qrReferenz(kundenNr, rechnungsNr) {
  const kunde = String(kundenNr ?? '').replace(/\D/g, '').slice(-6).padStart(6, '0');
  const rechnung = String(rechnungsNr ?? '').replace(/\D/g, '').slice(-20).padStart(20, '0');
  const basis = `${kunde}${rechnung}`;
  return basis + mod10(basis);
}

// Creditor Reference ISO 11649 (fuer normale IBAN ohne QR): RF + Pruefziffern + Referenz.
function scorReferenz(text) {
  const ref = String(text ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 21) || '0';
  const zahlen = [...`${ref}RF00`].map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c)).join('');
  let rest = 0;
  for (const z of zahlen) rest = (rest * 10 + Number(z)) % 97;
  return `RF${String(98 - rest).padStart(2, '0')}${ref}`;
}

// Naechste Rechnungs-Nr.: hoechste rein numerische Debitoren-Nr. + 1, sonst <Jahr>001.
function naechsteRechnungsNr(debitoren, jahr) {
  const zahlen = (debitoren ?? []).map((d) => String(d.rechnungsnummer ?? '').trim()).filter((n) => /^\d{1,12}$/.test(n)).map(Number);
  if (zahlen.length) return String(Math.max(...zahlen) + 1);
  return `${jahr}001`;
}

// Ziel-Datum: Rechnungsdatum + Tage (ISO).
function plusTage(iso, tage) {
  const [j, m, t] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(j, m - 1, t + Number(tage || 0)));
  return d.toISOString().slice(0, 10);
}

// Adresse fuer den QR-Code: Name + "Strasse Nr" + "PLZ Ort" -> strukturiert.
function adresseVon(name, strasse, plzOrt) {
  const a = adresseZerlegen([strasse, plzOrt].filter(Boolean).join(', '));
  if (!a) return null;
  return { name: String(name ?? '').slice(0, 70), strasse: a.strtNm ?? '', nr: a.bldgNb ?? '', plz: a.pstCd, ort: a.twnNm, land: a.ctry };
}

/**
 * Daten des Zahlteils pruefen und den Text fuer den QR-Code bilden (SPC 0200).
 * @returns {{ text, referenzTyp, referenz, fehler: [] }}
 */
function zahlteil({ iban, kreditor, debitor, betrag, waehrung = 'CHF', referenz, mitteilung = '' }) {
  const fehler = [];
  const i = kompakt(iban);
  if (!/^(CH|LI)\d{19}$/.test(i)) fehler.push('IBAN/QR-IBAN fehlt oder ist ungültig (Einstellungen › Rechnung)');
  if (!kreditor) fehler.push('Adresse des Rechnungsstellers unvollständig (Firma, Strasse, PLZ/Ort)');
  const qr = istQrIban(i);
  let referenzTyp = 'NON';
  let ref = '';
  if (qr) {
    referenzTyp = 'QRR';
    ref = kompakt(referenz);
    if (!qrReferenzGueltig(ref)) fehler.push('QR-Referenz ungültig');
  } else if (referenz) {
    referenzTyp = 'SCOR';
    ref = kompakt(referenz);
  }
  const b = Number(betrag);
  if (!(b > 0) || b > 999999999.99) fehler.push('Betrag ungültig');
  const adr = (a) => (a ? ['S', a.name, a.strasse, a.nr, a.plz, a.ort, a.land] : ['', '', '', '', '', '', '']);
  const zeilen = [
    'SPC', '0200', '1', i,
    ...adr(kreditor),
    '', '', '', '', '', '', '', // endgueltiger Zahlungsempfaenger (nicht verwendet)
    b > 0 ? b.toFixed(2) : '', waehrung,
    ...adr(debitor),
    referenzTyp, ref, String(mitteilung).slice(0, 140), 'EPD',
  ];
  return { text: zeilen.join('\r\n'), referenzTyp, referenz: ref, fehler };
}

// Anzeige der Referenz im Zahlteil: QRR in 5er-Gruppen von rechts (2 + 5x5), SCOR in 4er-Gruppen.
function referenzAnzeige(ref, typ) {
  if (!ref) return '';
  if (typ === 'QRR') return `${ref.slice(0, 2)} ${ref.slice(2).replace(/(\d{5})(?=\d)/g, '$1 ')}`;
  return ref.replace(/(.{4})(?=.)/g, '$1 ');
}
function ibanAnzeige(iban) {
  return kompakt(iban).replace(/(.{4})(?=.)/g, '$1 ');
}

// Positionen der Rechnung aus dem Detailrapport: Extra-Zeit je Ansatz.
function rechnungsPositionen(rapportDaten, rapportNummer, zeitraumText) {
  const proAnsatz = new Map();
  for (const z of rapportDaten.extra) {
    const p = proAnsatz.get(z.ansatz) ?? { ansatz: z.ansatz, minuten: 0, betrag: 0 };
    p.minuten += z.minuten;
    p.betrag = Math.round((p.betrag + z.betrag) * 100) / 100;
    proAnsatz.set(z.ansatz, p);
  }
  return [...proAnsatz.values()].map((p) => ({
    text: `Zusätzliche Arbeiten gemäss Detailrapport ${rapportNummer} (${zeitraumText})`,
    stunden: Math.round((p.minuten / 60) * 100) / 100, ansatz: p.ansatz, betrag: p.betrag,
  }));
}

export { mod10, qrReferenz, scorReferenz, naechsteRechnungsNr, plusTage, adresseVon, zahlteil, referenzAnzeige, ibanAnzeige, rechnungsPositionen };
