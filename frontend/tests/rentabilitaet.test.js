import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zeitraumVon, monateUeberlappung, ampel, auswerten, totale } from '../src/lib/rentabilitaet.js';

test('Zeitraum: Monat, Quartal, Jahr; laufend bis heute', () => {
  assert.deepEqual(zeitraumVon({ art: 'monat', jahr: 2026, nr: 2 }, '2026-11-16'), { von: '2026-02-01', bis: '2026-02-28', bisPlan: '2026-02-28', laufend: false });
  assert.deepEqual(zeitraumVon({ art: 'quartal', jahr: 2026, nr: 4 }, '2026-11-16'), { von: '2026-10-01', bis: '2026-12-31', bisPlan: '2026-11-16', laufend: true });
  assert.equal(zeitraumVon({ art: 'jahr', jahr: 2026 }, '2026-11-16').bisPlan, '2026-11-16');
});

test('Überlappung in Monaten (tagesgenau)', () => {
  const ganz = monateUeberlappung({ gueltig_ab: '2026-01-01', gueltig_bis: null }, '2026-01-01', '2026-12-31');
  assert.ok(Math.abs(ganz - 12) < 0.01);
  assert.equal(monateUeberlappung({ gueltig_ab: '2027-01-01' }, '2026-01-01', '2026-12-31'), 0);
  const halb = monateUeberlappung({ gueltig_ab: '2026-07-01', gueltig_bis: null }, '2026-01-01', '2026-12-31');
  assert.ok(Math.abs(halb - 6.04) < 0.05);
});

test('Ampel', () => {
  assert.deepEqual([ampel(0.5), ampel(1), ampel(1.2), ampel(null)], ['gruen', 'gelb', 'rot', null]);
});

test('Auswertung: Plan, Ist, Ertrag, Satz, offene Extra-Zeit', () => {
  const leistungen = [
    { id: 1, name: 'Finanzbuchhaltung', turnus: 'monatlich', minuten_pro_einheit: 3, stundenansatz_id: 1 },
    { id: 2, name: 'Lohnbuchhaltung', turnus: 'monatlich', minuten_pro_einheit: 10, stundenansatz_id: null },
  ];
  const ansaetze = [{ id: 1, chf_pro_stunde: 130, ist_standard: true }];
  const pauschalen = [
    { mandant_id: 7, leistung_id: 1, menge: 100, betrag_monat: 650, gueltig_ab: '2026-01-01' }, // 300 Min./Mt.
    { mandant_id: 7, leistung_id: 2, menge: 3, betrag_monat: 105, gueltig_ab: '2026-01-01' }, // 30 Min./Mt.
    { mandant_id: 7, abacus_modul_id: 5, betrag_monat: 80, gueltig_ab: '2026-01-01' }, // zaehlt nicht
  ];
  const zeitraum = zeitraumVon({ art: 'monat', jahr: 2026, nr: 3 }, '2026-11-16');
  const eintraege = [
    { mandant_id: 7, leistung_id: 1, art: 'pauschal', minuten: 360 },
    { mandant_id: 7, leistung_id: 2, art: 'pauschal', minuten: 15 },
    { mandant_id: 7, art: 'extra', minuten: 60, stundenansatz_chf: 130 },
    { mandant_id: null, art: 'intern', minuten: 99 },
  ];
  const offeneExtra = [
    { mandant_id: 7, art: 'extra', minuten: 90, stundenansatz_chf: 130, datum: '2026-02-03', rapport_id: null },
    { mandant_id: 7, art: 'extra', minuten: 30, stundenansatz_chf: 130, datum: '2026-03-05', rapport_id: null },
  ];
  const [m] = auswerten({ eintraege, pauschalen, leistungen, ansaetze, offeneExtra, zeitraum, mandanten: [{ id: 7, name: 'Muster AG' }] });
  assert.equal(m.name, 'Muster AG');
  assert.ok(Math.abs(m.planMinuten - 334) <= 2); // 330 x 31 Tage / 30.44
  assert.equal(m.istMinuten, 375);
  assert.ok(Math.abs(m.ertrag - 769.5) < 5);
  assert.equal(m.ampel, 'rot');
  const fibu = m.leistungen.find((l) => l.leistungId === 1);
  assert.equal(fibu.istMinuten, 360);
  assert.equal(fibu.zielsatz, 130);
  assert.ok(fibu.satz > 100 && fibu.satz < 115);
  assert.equal(m.extraMinuten, 60);
  assert.equal(m.extraBetrag, 130);
  assert.deepEqual([m.offenMinuten, m.offenBetrag, m.offenVon, m.offenBis], [120, 260, '2026-02-03', '2026-03-05']);
  const t = totale([m]);
  assert.equal(t.istMinuten, 375);
  assert.equal(t.offenBetrag, 260);
});
