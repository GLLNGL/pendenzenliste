import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrReferenzGueltig, scorGueltig } from '../src/lib/pain001.js';
import {
  mod10, qrReferenz, scorReferenz, naechsteRechnungsNr, plusTage, adresseVon, zahlteil, referenzAnzeige, ibanAnzeige, rechnungsPositionen,
} from '../src/lib/qrrechnung.js';

test('QR-Referenz mit gültiger Prüfziffer', () => {
  assert.equal(mod10('21000000000313947143000901'), '7'); // bekannte Referenz ...9017
  const r = qrReferenz('M-012', '2026005');
  assert.equal(r.length, 27);
  assert.ok(qrReferenzGueltig(r));
  assert.ok(r.startsWith('000012'));
});

test('RF-Referenz gültig', () => {
  assert.ok(scorGueltig(scorReferenz('2026005')));
  assert.equal(scorReferenz('539007547034'), 'RF18539007547034');
});

test('Rechnungs-Nr., Fälligkeit, Adresse', () => {
  assert.equal(naechsteRechnungsNr([{ rechnungsnummer: '1041' }, { rechnungsnummer: 'A-7' }, { rechnungsnummer: '1043' }], 2026), '1044');
  assert.equal(naechsteRechnungsNr([], 2026), '2026001');
  assert.equal(plusTage('2026-12-25', 10), '2027-01-04');
  assert.deepEqual(adresseVon('Muster AG', 'Bahnhofstrasse 12', '8001 Zürich'), { name: 'Muster AG', strasse: 'Bahnhofstrasse', nr: '12', plz: '8001', ort: 'Zürich', land: 'CH' });
  assert.equal(adresseVon('X', '', ''), null);
});

test('Zahlteil: QR-IBAN mit QRR, Datensatz SPC', () => {
  const ref = qrReferenz('12', '2026005');
  const z = zahlteil({
    iban: 'CH44 3199 9123 0008 8901 2', referenz: ref, betrag: 1234.5, mitteilung: 'Rechnung 2026005',
    kreditor: adresseVon('EST Controlling GmbH', 'Hardstrasse 73', '5430 Wettingen'),
    debitor: adresseVon('Muster AG', 'Bahnhofstrasse 12', '8001 Zürich'),
  });
  assert.deepEqual(z.fehler, []);
  assert.equal(z.referenzTyp, 'QRR');
  const zeilen = z.text.split('\r\n');
  assert.equal(zeilen.length, 31);
  assert.deepEqual(zeilen.slice(0, 11), ['SPC', '0200', '1', 'CH4431999123000889012', 'S', 'EST Controlling GmbH', 'Hardstrasse', '73', '5430', 'Wettingen', 'CH']);
  assert.deepEqual(zeilen.slice(18, 20), ['1234.50', 'CHF']);
  assert.equal(zeilen[20], 'S');
  assert.deepEqual(zeilen.slice(27), ['QRR', ref, 'Rechnung 2026005', 'EPD']);
});

test('Zahlteil: normale IBAN -> SCOR; Fehler werden gemeldet', () => {
  const z = zahlteil({ iban: 'CH9300762011623852957', referenz: scorReferenz('2026005'), betrag: 10, kreditor: adresseVon('A', 'Weg 1', '3000 Bern'), debitor: null });
  assert.equal(z.referenzTyp, 'SCOR');
  assert.deepEqual(z.fehler, []);
  const f = zahlteil({ iban: '', betrag: 0, kreditor: null });
  assert.equal(f.fehler.length, 3);
});

test('Anzeige und Positionen', () => {
  assert.equal(referenzAnzeige('210000000003139471430009017', 'QRR'), '21 00000 00003 13947 14300 09017');
  assert.equal(ibanAnzeige('CH4431999123000889012'), 'CH44 3199 9123 0008 8901 2');
  const p = rechnungsPositionen({ extra: [{ minuten: 60, ansatz: 130, betrag: 130 }, { minuten: 30, ansatz: 130, betrag: 65 }, { minuten: 30, ansatz: 90, betrag: 45 }] }, 'R-2026-01', '01.10.2026 – 31.10.2026');
  assert.deepEqual(p.map((x) => [x.stunden, x.ansatz, x.betrag]), [[1.5, 130, 195], [0.5, 90, 45]]);
});

import { qrMatrix, rsGenerator, rsRest, datenCodewoerter, alignPositionen } from '../src/lib/qrcode.js';

test('QR: Reed-Solomon (Referenz «HELLO WORLD» 1-M)', () => {
  const daten = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(rsRest(daten, rsGenerator(10)), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('QR: Kapazität, Ausrichtung, Format', () => {
  assert.equal(datenCodewoerter(1), 16);
  assert.equal(datenCodewoerter(10), 216);
  assert.deepEqual(alignPositionen(7), [6, 22, 38]);
  assert.deepEqual(alignPositionen(25), [6, 32, 58, 84, 110]);
  const m = qrMatrix('Hallo');
  assert.equal(m.length, 21);
  // Finder oben links: 7x7 Rahmen dunkel, Separator hell
  assert.ok(m[0][0] && m[0][6] && m[6][0] && m[6][6] && !m[7][7] && m[3][3]);
  assert.equal(m[21 - 8][8], true); // dunkles Modul
});

test('QR: Swiss-QR-Datensatz passt in Version ≤ 25', () => {
  const z = zahlteil({
    iban: 'CH4431999123000889012', referenz: qrReferenz('12', '2026005'), betrag: 1234.5, mitteilung: 'Rechnung 2026005',
    kreditor: adresseVon('EST Controlling GmbH', 'Hardstrasse 73', '5430 Wettingen'),
    debitor: adresseVon('Muster AG', 'Bahnhofstrasse 12', '8001 Zürich'),
  });
  const g = qrMatrix(z.text).length;
  assert.ok(g <= 25 * 4 + 17, `Version zu gross: ${g}`);
});
