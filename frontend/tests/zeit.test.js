import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  laufendeMinuten, formatiereDauer, parseDauer, leistungVorschlag, artVorschlag, ansatzFuer,
  betragExtra, zusammenfassung, zeitraum,
} from '../src/lib/zeit.js';

test('Timer-Minuten: angefangene Minute zählt, mindestens 1', () => {
  const start = '2026-11-06T08:00:00Z';
  assert.equal(laufendeMinuten(start, Date.parse('2026-11-06T08:00:10Z')), 1);
  assert.equal(laufendeMinuten(start, Date.parse('2026-11-06T08:30:00Z')), 30);
  assert.equal(laufendeMinuten(start, Date.parse('2026-11-06T08:30:01Z')), 31);
});

test('Dauer formatieren und einlesen', () => {
  assert.equal(formatiereDauer(65), '1:05');
  assert.equal(formatiereDauer(5), '0:05');
  assert.equal(parseDauer('1:30'), 90);
  assert.equal(parseDauer('1.5'), 90);
  assert.equal(parseDauer('0,25 h'), 15);
  assert.equal(parseDauer('45'), 45);
  assert.equal(parseDauer('45 Min.'), 45);
  assert.equal(parseDauer('1:75'), null);
  assert.equal(parseDauer('abc'), null);
  assert.equal(parseDauer('0'), null);
});

test('Vorschläge für Leistung und Art', () => {
  const pauschalen = [{ leistung_id: 1 }, { abacus_modul_id: 7 }];
  assert.equal(leistungVorschlag({ leistung_id: 5 }, pauschalen), 5);
  assert.equal(leistungVorschlag({}, pauschalen), 1);
  assert.equal(leistungVorschlag({}, [...pauschalen, { leistung_id: 2 }]), null);
  assert.equal(artVorschlag(null, 1, pauschalen), 'intern');
  assert.equal(artVorschlag(3, 1, pauschalen), 'pauschal');
  assert.equal(artVorschlag(3, '8', pauschalen), 'extra');
  assert.equal(artVorschlag(3, null, pauschalen), 'pauschal');
  assert.equal(artVorschlag(3, null, []), 'extra');
});

test('Ansatz und Betrag für Extra-Arbeit', () => {
  const ansaetze = [{ id: 1, chf_pro_stunde: '130', ist_standard: true }, { id: 2, chf_pro_stunde: 90 }];
  assert.equal(ansatzFuer({ preis_art: 'zeit', stundenansatz_id: 2 }, ansaetze), 90);
  assert.equal(ansatzFuer({ preis_art: 'fix' }, ansaetze), 130);
  assert.equal(ansatzFuer(null, ansaetze), 130);
  assert.equal(betragExtra({ art: 'extra', minuten: 90, stundenansatz_chf: '130' }), 195);
  assert.equal(betragExtra({ art: 'pauschal', minuten: 90, stundenansatz_chf: 130 }), null);
});

test('Zusammenfassung', () => {
  const s = zusammenfassung([
    { art: 'pauschal', minuten: 60 }, { art: 'extra', minuten: 30, stundenansatz_chf: 130 },
    { art: 'intern', minuten: 15 }, { art: 'extra', minuten: null },
  ]);
  assert.deepEqual(s, { gesamt: 105, pauschal: 60, extra: 30, intern: 15, extraBetrag: 65, laufend: 1 });
});

test('Zeiträume', () => {
  assert.deepEqual(zeitraum('woche', '2026-11-06'), { von: '2026-11-02', bis: '2026-11-08' });
  assert.deepEqual(zeitraum('vorwoche', '2026-11-02'), { von: '2026-10-26', bis: '2026-11-01' });
  assert.deepEqual(zeitraum('monat', '2026-02-10'), { von: '2026-02-01', bis: '2026-02-28' });
  assert.deepEqual(zeitraum('vormonat', '2026-01-15'), { von: '2025-12-01', bis: '2025-12-31' });
});
