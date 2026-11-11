import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  zahl, mwstLeer, mwstMethodeWechseln, mwstBerechnen, svLeer, svBerechnen, bewertungGesamt, abstimmungOrdner, standardJahr,
} from '../src/lib/abstimmung.js';

test('zahl: Schweizer Schreibweisen', () => {
  assert.equal(zahl("1'234.50"), 1234.5);
  assert.equal(zahl('1234,5'), 1234.5);
  assert.equal(zahl('-12'), -12);
  assert.equal(zahl(''), null);
  assert.equal(zahl('abc'), null);
});

test('MWST effektiv: Umsatz, Steuer, Vorsteuer und Abrechnungskonto', () => {
  const d = mwstLeer({ mwst_periode: 'Quartal' });
  assert.equal(d.methode, 'effektiv');
  assert.equal(d.perioden.length, 4);
  d.perioden = d.perioden.map((p) => ({ ...p, umsatz: 25000, steuer: 2025, vorsteuer: 300, bezahlt: 1725 }));
  d.perioden[3].bezahlt = 0; // Q4 per 31.12. noch offen
  d.umsatzBuchhaltung = 101000;
  d.korrekturen = [{ text: 'Zinsertrag nicht steuerbar', betrag: -1000 }];
  d.steuerKonto = 8100;
  d.vorsteuerKonto = 1150;
  d.saldoAbrechnungskonto = 1725;
  const r = mwstBerechnen(d);
  assert.equal(r.umsatzDeklariert, 100000);
  assert.equal(r.umsatzSoll, 100000);
  assert.deepEqual(r.diffUmsatz, { betrag: 0, ok: true });
  assert.deepEqual(r.diffSteuer, { betrag: 0, ok: true });
  assert.deepEqual(r.diffVorsteuer, { betrag: -50, ok: false });
  assert.equal(r.zahllast, 6900);
  assert.equal(r.offen, 1725);
  assert.deepEqual(r.diffKonto, { betrag: 0, ok: true });
  assert.equal(bewertungGesamt(r), 'differenz');
});

test('MWST Saldosteuersatz: zwei Semester, Steuer = Umsatz x Satz', () => {
  const d = mwstLeer({ mwst_periode: 'Semester' });
  assert.equal(d.methode, 'saldo');
  d.perioden = d.perioden.map((p) => ({ ...p, umsatz: 50000, steuer: 3100 }));
  d.sssSatz = 6.2;
  const r = mwstBerechnen(d);
  assert.equal(r.steuerSoll, 6200);
  assert.deepEqual(r.diffSss, { betrag: 0, ok: true });
  assert.equal(r.diffVorsteuer.ok, null);
  assert.equal(bewertungGesamt(r), 'ok');
});

test('MWST: Methode wechseln behaelt Werte', () => {
  const d = mwstLeer({});
  d.perioden[0].umsatz = 10;
  const s = mwstMethodeWechseln(d, 'saldo');
  assert.deepEqual(s.perioden.map((p) => p.label), ['1. Semester', '2. Semester']);
  assert.equal(s.perioden[0].umsatz, 10);
});

test('MWST: ohne Angaben keine Bewertung', () => {
  assert.equal(bewertungGesamt(mwstBerechnen(mwstLeer({}))), 'leer');
});

test('AHV: Soll-Beitraege, Schlussabrechnung, Kontokorrent, AN-Abzuege', () => {
  const d = svLeer('ahv');
  d.lohnsumme = 500000;
  d.korrekturen = [{ text: 'Rentnerfreibetrag', betrag: -16800 }];
  d.beitraege[2].satz = 1.5; // FAK
  d.beitraege[3].satz = 0.5; // Verwaltungskosten (vereinfacht auf Lohnsumme)
  const r0 = svBerechnen(d);
  assert.equal(r0.massgebend, 483200);
  assert.deepEqual(r0.zeilen.map((z) => z.soll), [51219.2, 10630.4, 7248, 2416]);
  assert.equal(r0.sollTotal, 71513.6);
  assert.equal(r0.anSoll, 30924.8);
  d.abrechnung = 71513.6;
  d.akonto = 70000;
  d.saldoKonto = 1513.6;
  d.anAbzuege = 30924.8;
  const r = svBerechnen(d);
  assert.equal(r.erwarteterSaldo, 1513.6);
  assert.equal(bewertungGesamt(r), 'ok');
  d.saldoKonto = 1000;
  assert.deepEqual(svBerechnen(d).diffKonto, { betrag: -513.6, ok: false });
});

test('BVG: Beitrag als fixer Betrag laut Abrechnung', () => {
  const d = svLeer('bvg');
  d.beitraege[0].betrag = 24000;
  d.abrechnung = 24000;
  d.anAbzuege = 12000;
  const r = svBerechnen(d);
  assert.equal(r.sollTotal, 24000);
  assert.equal(r.anSoll, 12000);
  assert.equal(bewertungGesamt(r), 'ok');
});

test('Saetze aus dem Vorjahr, Betraege nicht', () => {
  const d = svLeer('uvg', { beitraege: [{ bez: 'BU', satz: 0.1, an: 0 }, { bez: 'NBU', satz: 1.2, an: 100 }], lohnsumme: 1 });
  assert.deepEqual(d.beitraege, [{ bez: 'BU', satz: 0.1, an: 0 }, { bez: 'NBU', satz: 1.2, an: 100 }]);
  assert.equal(d.lohnsumme, '');
});

test('Ablageordner und Standardjahr', () => {
  assert.deepEqual(abstimmungOrdner(['Muster AG'], 2025, 'ahv'), ['Muster AG', 'Jahresabschluss', '2025', 'Sozialversicherungen', 'AHV']);
  assert.deepEqual(abstimmungOrdner(['Muster AG'], 2025, 'mwst'), ['Muster AG', 'Jahresabschluss', '2025', 'MWST']);
  assert.equal(abstimmungOrdner(null, 2025, 'mwst'), null);
  assert.equal(standardJahr(new Date(2026, 10, 11)), 2025);
  assert.equal(standardJahr(new Date(2026, 11, 20)), 2026);
});
