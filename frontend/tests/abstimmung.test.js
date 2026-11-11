import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  zahl, nummernListe, grundlagenLesen, mwstLeer, mwstRhythmusWechseln, mwstBerechnen, svLeer, svBerechnen,
  bewertungGesamt, abstimmungOrdner, standardJahr, tabellenBlock, GRUNDLAGEN,
} from '../src/lib/abstimmung.js';

// Erfundene Zahlen (keine Kundendaten).
const ER = [
  ['Nummer', 'Bezeichnung', 'Saldo'],
  [],
  ['5', 'Personalaufwand'],
  ['5000', 'Löhne', -100000],
  ['5004', 'Privatanteil Fahrzeug', -2400],
  ['50', 'Total Lohnaufwand', -102400],
  ['5700', 'AHV, IV, EO, ALV', -7000],
  ['5720', 'Vorsorgeeinrichtungen', -1500],
  ['5730', 'Unfallversicherung', -500],
  ['2270', 'Kontokorrent AHV', -1500],
];
const JOURNAL = [
  ['Personal-Nr.', 'Vorname', 'Nachname', 'Währung', 'LA', 'Lohnartentext', 'Jan.', 'Total'],
  ['1', 'A', 'X', 'CHF', '5000', 'Bruttolohn', 5000, 60000],
  ['1', 'A', 'X', 'CHF', '6000', 'AHV-Beitrag', -265, -3180],
  ['1', 'A', 'X', 'CHF', '9500', 'AG AHV-Beitrag', 265, 3180],
  ['1', 'A', 'X', 'CHF', '6200', 'BVG-Beitrag', -125, -1500],
  ['1', 'A', 'X', 'CHF', '9700', 'AG BVG-Beitrag', 125, 1500],
  ['2', 'B', 'Y', 'CHF', '5000', 'Bruttolohn', 3400, 40000],
  ['2', 'B', 'Y', 'CHF', '6000', 'AHV-Beitrag', -180, -2120],
  ['2', 'B', 'Y', 'CHF', '9500', 'AG AHV-Beitrag', 180, 2120],
  ['2', 'B', 'Y', 'CHF', '9570', 'AG FAK-Beitrag', 20, 1500],
  [],
  ['2 abgerechnete Mitarbeiter'],
  ['', '', '', '', '5000', 'Bruttolohn', 8400, 100000],
  ['', '', '', '', '6000', 'AHV-Beitrag', -445, -5300],
];

test('zahl und Nummernliste', () => {
  assert.equal(zahl("1'234.50"), 1234.5);
  assert.equal(zahl('1234,5'), 1234.5);
  assert.equal(zahl('(12)'), -12);
  assert.equal(zahl('abc'), null);
  assert.deepEqual(nummernListe('5000, 5003-5005;6000'), ['5000', '5003', '5004', '5005', '6000']);
});

test('Erfolgsrechnung lesen: nur Konten mit 4+ Ziffern', () => {
  const r = grundlagenLesen(ER);
  assert.equal(r.art, 'konten');
  assert.deepEqual(r.konten.map((k) => k.konto), ['5000', '5004', '5700', '5720', '5730', '2270']);
  assert.equal(r.konten[0].saldo, -100000);
});

test('Kumulativjournal lesen: Personenzeilen summiert, Totalblock nicht doppelt', () => {
  const r = grundlagenLesen(JOURNAL);
  assert.equal(r.art, 'journal');
  assert.equal(r.personen, 2);
  const la = Object.fromEntries(r.lohnarten.map((l) => [l.la, l.total]));
  assert.deepEqual(la, { 5000: 100000, 6000: -5300, 6200: -1500, 9500: 5300, 9570: 1500, 9700: 1500 });
});

test('Kumulativjournal nur mit Totalzeilen', () => {
  const r = grundlagenLesen([['LA', 'Lohnartentext', 'Total'], ['5000', 'Bruttolohn', 1000], ['6000', 'AHV', -53]]);
  assert.deepEqual(r.lohnarten.map((l) => [l.la, l.total]), [['5000', 1000], ['6000', -53]]);
});

test('unbekannte Tabelle -> null', () => {
  assert.equal(grundlagenLesen([['a', 'b'], [1, 2]]), null);
});

const grundlagen = { konten: grundlagenLesen(ER).konten, lohnarten: grundlagenLesen(JOURNAL).lohnarten };

test('AHV: FiBu vs. Lohnjournal vs. Schlussabrechnung, Lohnsumme, Abgrenzung', () => {
  const d = svLeer('ahv');
  d.beitraege[0].rechnung = 10600; // AHV/IV/EO AN+AG
  d.beitraege[2].rechnung = 1500; // FAK
  d.lohnKorrekturen = [{ text: 'Privatanteil nicht deklariert', betrag: -2400 }];
  d.deklaration = 100000;
  d.akonto = 10500;
  d.kontoBilanz = '2270';
  d.saldoBilanz = 1600;
  const r = svBerechnen(d, grundlagen);
  assert.equal(r.fibu, 7000);
  assert.equal(r.ag, 6800); // 5300 + 1500 FAK
  assert.deepEqual(r.diffFibuJournal, { betrag: 200, ok: false });
  assert.equal(r.an, 5300);
  assert.equal(r.lohn, 12100);
  assert.deepEqual(r.diffRechnung, { betrag: 0, ok: true });
  assert.deepEqual(r.diffRechnungFibu, { betrag: -200, ok: false });
  assert.deepEqual(r.lohnKonten.map((k) => k.konto), ['5000', '5004']);
  assert.equal(r.lohnFibu, 102400);
  assert.equal(r.pflichtig, 100000);
  assert.deepEqual(r.diffDeklaration, { betrag: 0, ok: true });
  assert.deepEqual(r.diffBrutto, { betrag: -2400, ok: false });
  assert.equal(r.abzugrenzen, 1600);
  assert.deepEqual(r.diffBilanz, { betrag: 0, ok: true });
  assert.equal(r.saldoAusListe, 1500);
  assert.equal(bewertungGesamt(r), 'differenz');
});

test('BVG: alles stimmt', () => {
  const d = svLeer('bvg');
  d.beitraege[0].rechnung = 3000;
  const r = svBerechnen(d, grundlagen);
  assert.deepEqual([r.fibu, r.ag, r.an, r.lohn], [1500, 1500, 1500, 3000]);
  assert.equal(bewertungGesamt(r), 'ok');
});

test('ohne Grundlagen keine Bewertung', () => {
  assert.equal(bewertungGesamt(svBerechnen(svLeer('uvg'), {})), 'leer');
});

test('Zuordnung aus dem Vorjahr, Betraege nicht', () => {
  const d = svLeer('ahv', { konten: '5700, 5701', beitraege: [{ bez: 'AHV', laAN: '6000', laAG: '9500', rechnung: 99 }], lohnKonten: '5000', lohnKorrekturen: [{ text: 'QST', betrag: 5 }] });
  assert.equal(d.konten, '5700, 5701');
  assert.deepEqual(d.beitraege, [{ bez: 'AHV', laAN: '6000', laAG: '9500', rechnung: '' }]);
  assert.deepEqual(d.lohnKorrekturen, [{ text: 'QST', betrag: '' }]);
});

test('MWST: ESTV vs. Verbuchung pro Quartal und Jahresabstimmung', () => {
  const d = mwstLeer({ mwst_periode: 'Quartal' });
  assert.equal(d.perioden.length, 4);
  d.perioden[0].estv = { umsatz: 100000, steuerfrei: 0, v1170: 500, v1171: 1000, k2203: 0 };
  d.perioden[0].buch = { umsatz: 99000, steuerfrei: 0, v1170: 600, v1171: 1000, k2203: 100 };
  d.perioden[1].estv = { umsatz: 50000, steuerfrei: 10000, v1170: 0, v1171: 0, k2203: 0 };
  d.perioden[1].buch = { umsatz: 50000, steuerfrei: 10000, v1170: 0, v1171: 0, k2203: 0 };
  const r = mwstBerechnen(d);
  assert.equal(r.perioden[0].estv.steuer, 8100);
  assert.equal(r.perioden[0].estv.zahllast, 6600);
  assert.equal(r.perioden[0].buch.zahllast, 6519); // 8019 - 600 - 1000 + 100
  assert.deepEqual(r.perioden[0].delta, { betrag: -81, ok: false });
  assert.deepEqual(r.perioden[1].delta, { betrag: 0, ok: true });
  assert.equal(r.perioden[2].delta.ok, null);
  assert.equal(r.spalten.umsatz, -1000);
  assert.equal(r.spalten.steuer, -81);
  assert.equal(r.spalten.zahllast, -81);
  assert.equal(r.check, 0);
  assert.equal(bewertungGesamt(r), 'differenz');
});

test('MWST: Satz pro Periode, Semester, Rhythmus wechseln', () => {
  const d = mwstRhythmusWechseln(mwstLeer({}), 'semester');
  assert.deepEqual(d.perioden.map((p) => p.label), ['1. Semester', '2. Semester']);
  d.perioden[0].satz = 6.2;
  d.perioden[0].estv.umsatz = 1000;
  d.perioden[0].buch.umsatz = 1000;
  const r = mwstBerechnen(d);
  assert.equal(r.perioden[0].estv.steuer, 62);
  assert.equal(bewertungGesamt(r), 'ok');
  assert.equal(mwstLeer({}, { rhythmus: 'monat', satz: 2.6 }).perioden.length, 12);
});

test('Excel-Block und Ablage', () => {
  assert.deepEqual(tabellenBlock('1\t2\r\n3\t4\r\n'), [['1', '2'], ['3', '4']]);
  assert.deepEqual(abstimmungOrdner(['M'], 2025, 'ahv'), ['M', 'Jahresabschluss', '2025', 'Sozialversicherungen', 'AHV']);
  assert.deepEqual(abstimmungOrdner(['M'], 2025, GRUNDLAGEN), ['M', 'Jahresabschluss', '2025', 'Sozialversicherungen']);
  assert.equal(abstimmungOrdner(null, 2025, 'mwst'), null);
  assert.equal(standardJahr(new Date(2026, 10, 11)), 2025);
});
