import { test } from 'node:test';
import assert from 'node:assert/strict';
import { camtLesen, csvAuszugLesen, abgleichen, referenzNorm, referenzAusText, istReferenz } from '../src/lib/kontoauszug.js';
import { csvZerlegen } from '../src/lib/buchungsjournal.js';

const CAMT = `<?xml version="1.0"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt><Stmt>
  <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="CHF">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-11-02</Dt></Dt></Bal>
  <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="CHF">3491.49</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-11-08</Dt></Dt></Bal>
  <Ntry><Amt Ccy="CHF">281.05</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-11-04</Dt></BookgDt>
    <NtryDtls><TxDtls><RltdPties><Dbtr><Pty><Nm>Novais GmbH</Nm></Pty></Dbtr></RltdPties>
    <RmtInf><Strd><CdtrRefInf><Ref>21 00000 00003 13947 14300 09017</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls></Ntry>
  <Ntry><Amt Ccy="CHF">500.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-11-05</Dt></BookgDt>
    <NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Bad Ideen GmbH</Nm></Dbtr></RltdPties><RmtInf><Ustrd>Rechnung 105 Danke</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
  <Ntry><Amt Ccy="CHF">90.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-11-06</Dt></BookgDt></Ntry>
</Stmt></BkToCstmrStmt></Document>`;

test('camt.053 lesen: Gutschriften, Belastungen, Schlusssaldo', () => {
  const r = camtLesen(CAMT);
  assert.equal(r.buchungen.length, 3);
  assert.deepEqual(r.buchungen[0], { datum: '2026-11-04', richtung: 'gutschrift', waehrung: 'CHF', betrag: 281.05, gegenpartei: 'Novais GmbH', referenz: '210000000003139471430009017', text: '' });
  assert.equal(r.buchungen[1].text, 'Rechnung 105 Danke');
  assert.equal(r.buchungen[2].richtung, 'belastung');
  assert.deepEqual(r.schlusssaldo, { betrag: 3491.49, datum: '2026-11-08' });
});

test('CSV-Auszug lesen (Gutschrift/Belastung-Spalten)', () => {
  const zeilen = csvZerlegen([
    'Abschlussdatum;Buchungstext;Belastung;Gutschrift',
    '04.11.2026;Gutschrift Novais GmbH;;281.05',
    "05.11.2026;Lastschrift Swisscom;90.00;",
    "06.11.2026;Zahlung Bad Ideen Rechnung 105;;1'200.00",
  ].join('\n'));
  const r = csvAuszugLesen(zeilen);
  assert.deepEqual(r.buchungen.map((b) => [b.datum, b.richtung, b.betrag]), [['2026-11-04', 'gutschrift', 281.05], ['2026-11-05', 'belastung', 90], ['2026-11-06', 'gutschrift', 1200]]);
});

test('Abgleich mit offenen Debitoren', () => {
  const { buchungen } = camtLesen(CAMT);
  const debitoren = [
    { id: 1, partner: 'Novais GmbH', rechnungsnummer: '99', betrag: 281.05, zahlungsreferenz: '210000000003139471430009017' },
    { id: 2, partner: 'Bad Ideen GmbH', rechnungsnummer: '105', betrag: 500 },
    { id: 3, partner: 'Andere AG', rechnungsnummer: '106', betrag: 500 },
    { id: 4, partner: 'Bezahlt AG', betrag: 281.05, bezahlt_am: '2026-10-01' },
  ];
  const r = abgleichen(buchungen, debitoren);
  assert.equal(r.length, 2); // nur Gutschriften
  assert.deepEqual([r[0].beleg?.id, r[0].sicherheit, r[0].grund], [1, 'sicher', 'QR-Referenz']);
  assert.deepEqual([r[1].beleg?.id, r[1].sicherheit], [2, 'sicher']);
});

test('Abgleich: nur gleicher Betrag bei mehreren Kandidaten ist unsicher', () => {
  const buchungen = [{ datum: '2026-11-04', richtung: 'gutschrift', betrag: 500, gegenpartei: '', referenz: '', text: '' }];
  const r = abgleichen(buchungen, [{ id: 2, partner: 'A AG', betrag: 500 }, { id: 3, partner: 'B AG', betrag: 500 }]);
  assert.equal(r[0].sicherheit, 'unsicher');
  const r2 = abgleichen(buchungen, [{ id: 2, partner: 'A AG', betrag: 500 }]);
  assert.equal(r2[0].sicherheit, 'wahrscheinlich');
  const r3 = abgleichen(buchungen, [{ id: 2, partner: 'A AG', betrag: 400 }]);
  assert.equal(r3[0].beleg, null);
});

// QR-Referenz mit gueltiger Pruefziffer (aus pain001-Tests bekannt).
const QRR = '210000000003139471430009017';
const zahlung = (extra) => ({ datum: '2026-11-04', richtung: 'gutschrift', betrag: 281.05, gegenpartei: '', referenz: '', text: '', ...extra });

test('QR-Referenz: Leerzeichen und fehlende fuehrende Nullen spielen keine Rolle', () => {
  const r = abgleichen([zahlung({ referenz: QRR })], [{ id: 1, partner: 'X', betrag: 281.05, zahlungsreferenz: '21 00000 00003 13947 14300 09017' }]);
  assert.deepEqual([r[0].beleg?.id, r[0].sicherheit, r[0].grund], [1, 'sicher', 'QR-Referenz']);
  // Fuehrende Nullen fehlen in der gespeicherten Referenz.
  const r2 = abgleichen([zahlung({ referenz: '000000000000000000000001236' })], [{ id: 2, partner: 'X', betrag: 281.05, zahlungsreferenz: '1236' }]);
  assert.equal(r2[0].beleg?.id, 2);
});

test('QR-Referenz schlaegt gleichen Betrag einer anderen Rechnung', () => {
  const debitoren = [
    { id: 1, partner: 'Andere AG', rechnungsnummer: '1', betrag: 281.05 },
    { id: 2, partner: 'Novais GmbH', rechnungsnummer: '2', betrag: 281.05, zahlungsreferenz: QRR },
  ];
  const r = abgleichen([zahlung({ referenz: QRR })], debitoren);
  assert.equal(r[0].beleg?.id, 2);
});

test('verschiedene gueltige QR-Referenzen = andere Rechnung, auch bei gleichem Betrag', () => {
  const andere = '000000000000000000000001236';
  assert.ok(istReferenz(andere));
  const r = abgleichen([zahlung({ referenz: QRR })], [{ id: 1, partner: 'X', betrag: 281.05, zahlungsreferenz: andere }]);
  assert.equal(r[0].beleg, null);
});

test('QR-Referenz in der Mitteilung (camt ohne strukturierte Referenz)', () => {
  const xml = `<Document><Ntry><Amt Ccy="CHF">281.05</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-11-04</Dt></BookgDt>
    <AddtlNtryInf>Gutschrift QR 21 00000 00003 13947 14300 09017</AddtlNtryInf></Ntry></Document>`;
  const { buchungen } = camtLesen(xml);
  assert.equal(buchungen[0].referenz, QRR);
  const r = abgleichen(buchungen, [{ id: 7, partner: 'X', betrag: 281.05, zahlungsreferenz: QRR }]);
  assert.equal(r[0].beleg?.id, 7);
});

test('Rechnung ohne Referenz: Rechnungs-Nr. in der QR-Referenz', () => {
  const nr = QRR.slice(0, 26).replace(/^0+/, '').slice(-4); // letzte 4 Ziffern vor Pruefziffer
  const r = abgleichen([zahlung({ referenz: QRR })], [{ id: 3, partner: 'X', rechnungsnummer: `RE-${nr}`, betrag: 281.05 }, { id: 4, partner: 'Y', betrag: 281.05 }]);
  assert.deepEqual([r[0].beleg?.id, r[0].sicherheit], [3, 'sicher']);
});

test('Referenz einer bezahlten Rechnung wird nicht einer anderen zugeordnet', () => {
  const r = abgleichen([zahlung({ referenz: QRR })], [
    { id: 1, partner: 'X', rechnungsnummer: '5', betrag: 281.05, zahlungsreferenz: QRR, bezahlt_am: '2026-10-30' },
    { id: 2, partner: 'Y', betrag: 281.05 },
  ]);
  assert.equal(r[0].beleg, null);
  assert.match(r[0].grund, /bereits bezahlt am 30\.10\.2026/);
});

test('Referenz ohne passende Rechnung: klarer Grund', () => {
  const r = abgleichen([zahlung({ referenz: QRR, betrag: 999 })], [{ id: 1, partner: 'X', betrag: 50 }]);
  assert.equal(r[0].grund, 'QR-Referenz bei keiner offenen Rechnung hinterlegt');
});

test('referenzNorm / referenzAusText', () => {
  assert.equal(referenzNorm(' 00 12 3 '), '123');
  assert.equal(referenzNorm('rf18 5390 0754 7034'), 'RF18539007547034');
  assert.equal(referenzAusText('Zahlung Ref 21 00000 00003 13947 14300 09017 danke'), QRR);
  assert.equal(referenzAusText('Rechnung 105'), null);
});
