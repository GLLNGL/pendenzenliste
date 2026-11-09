import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ibanGueltig, istQrIban, qrReferenzGueltig, scorGueltig, adresseZerlegen, referenzArt, zahlungPruefen, zahlungHinweise, pain001,
} from '../src/lib/pain001.js';

// Beispielwerte aus den Implementation Guidelines der QR-Rechnung (SIX).
const QR_IBAN = 'CH44 3199 9123 0008 8901 2';
const QR_REF = '21 00000 00003 13947 14300 09017';
const IBAN = 'CH93 0076 2011 6238 5295 7';

test('IBAN und QR-IBAN', () => {
  assert.equal(ibanGueltig(IBAN), true);
  assert.equal(ibanGueltig('CH93 0076 2011 6238 5295 8'), false);
  assert.equal(ibanGueltig(QR_IBAN), true);
  assert.equal(istQrIban(QR_IBAN), true);
  assert.equal(istQrIban(IBAN), false);
  assert.equal(ibanGueltig('DE89 3704 0044 0532 0130 00'), true);
});

test('QR-Referenz und RF-Referenz', () => {
  assert.equal(qrReferenzGueltig(QR_REF), true);
  assert.equal(qrReferenzGueltig('210000000003139471430009018'), false);
  assert.equal(scorGueltig('RF18 5390 0754 7034'), true);
  assert.equal(scorGueltig('RF19 5390 0754 7034'), false);
});

test('Adresse zerlegen', () => {
  assert.deepEqual(adresseZerlegen('Bahnhofstrasse 1, 8001 Zürich'), { pstCd: '8001', twnNm: 'Zürich', ctry: 'CH', strtNm: 'Bahnhofstrasse', bldgNb: '1' });
  assert.deepEqual(adresseZerlegen('Postfach, 9490 Vaduz, Liechtenstein'), { pstCd: '9490', twnNm: 'Vaduz', ctry: 'LI', strtNm: 'Postfach' });
  assert.equal(adresseZerlegen('Zürich'), null);
  assert.equal(adresseZerlegen(''), null);
});

test('Referenzart und Prüfung einer Zahlung', () => {
  assert.equal(referenzArt(QR_IBAN, QR_REF).typ, 'QRR');
  assert.ok(referenzArt(QR_IBAN, 'Rechnung 12').fehler);
  assert.equal(referenzArt(IBAN, 'RF18539007547034').typ, 'SCOR');
  assert.deepEqual(referenzArt(IBAN, 'Rechnung 12'), { typ: 'NON', mitteilung: 'Rechnung 12' });
  const gut = { iban: QR_IBAN, zahlungsreferenz: QR_REF, betrag: 540.5, waehrung: 'CHF', partner_adresse: 'Bahnhofstrasse 1, 8001 Zürich' };
  assert.deepEqual(zahlungPruefen(gut), []);
  assert.deepEqual(zahlungPruefen({ ...gut, iban: '', partner_adresse: '' }), ['IBAN fehlt']);
  assert.deepEqual(zahlungHinweise({ ...gut, partner_adresse: '' }), ['ohne Adresse']);
  assert.ok(zahlungPruefen({ ...gut, iban: 'DE89370400440532013000' }).some((f) => f.startsWith('Auslandzahlung')));
});

test('pain.001 erzeugen', () => {
  const datei = pain001(
    { msgId: 'AM-20261111100000', erstelltAm: '2026-11-11T10:00:00', ausfuehrungsdatum: '2026-11-13', auftraggeber: 'estcontrolling GmbH', iban: IBAN, bic: 'UBSWCHZH80A' },
    [
      { id: 7, partner: 'Muster & Söhne AG', partner_adresse: 'Bahnhofstrasse 1, 8001 Zürich', iban: QR_IBAN, zahlungsreferenz: QR_REF, betrag: 540.5, waehrung: 'CHF' },
      { id: 8, partner: 'Lieferant GmbH', partner_adresse: '', iban: IBAN, zahlungsreferenz: '', rechnungsnummer: 'R-9', betrag: '100', waehrung: 'CHF' },
      { id: 9, partner: 'Euro AG', partner_adresse: 'Weg 3, 9490 Vaduz, LI', iban: IBAN, zahlungsreferenz: 'RF18539007547034', betrag: 50, waehrung: 'EUR' },
    ],
  );
  assert.match(datei, /xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09"/);
  assert.match(datei, /<MsgId>AM-20261111100000<\/MsgId>/);
  assert.match(datei, /<NbOfTxs>3<\/NbOfTxs><CtrlSum>690.50<\/CtrlSum>/);
  assert.equal((datei.match(/<PmtInf>/g) || []).length, 2); // CHF und EUR getrennt
  assert.match(datei, /<Prtry>QRR<\/Prtry><\/CdOrPrtry><\/Tp><Ref>210000000003139471430009017<\/Ref>/);
  assert.match(datei, /<Cd>SCOR<\/Cd>/);
  assert.match(datei, /<Ustrd>Rechnung R-9<\/Ustrd>/);
  assert.match(datei, /<Cdtr><Nm>Lieferant GmbH<\/Nm><\/Cdtr>/); // ohne Adresse
  assert.match(datei, /<Nm>Muster &amp; Söhne AG<\/Nm>/);
  assert.match(datei, /<InstdAmt Ccy="EUR">50.00<\/InstdAmt>/);
  assert.match(datei, /<ReqdExctnDt><Dt>2026-11-13<\/Dt><\/ReqdExctnDt>/);
  assert.match(datei, /<BICFI>UBSWCHZH80A<\/BICFI>/);
});
