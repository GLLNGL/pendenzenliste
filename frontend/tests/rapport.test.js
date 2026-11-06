import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rundeMinuten, rapportDaten, naechsteRapportNummer, stundenText } from '../src/lib/rapport.js';

test('Rundung je Eintrag', () => {
  assert.equal(rundeMinuten(1, 5), 5);
  assert.equal(rundeMinuten(7, 5), 5);
  assert.equal(rundeMinuten(8, 5), 10);
  assert.equal(rundeMinuten(62, 15), 60);
  assert.equal(rundeMinuten(7, 1), 7);
});

test('Rapport trennt Pauschale und Extra, ohne Intern und laufende Timer', () => {
  const d = rapportDaten([
    { id: 3, datum: '2026-10-12', art: 'extra', minuten: 88, stundenansatz_chf: '130', beschreibung: 'Sonderauswertung' },
    { id: 1, datum: '2026-10-05', art: 'pauschal', minuten: 42, leistungen: { name: 'Finanzbuchhaltung (Standard)' }, pendenzen: { titel: 'Belege verbuchen' } },
    { id: 2, datum: '2026-10-05', art: 'pauschal', minuten: 20 },
    { id: 4, datum: '2026-10-06', art: 'intern', minuten: 30 },
    { id: 5, datum: '2026-10-07', art: 'extra', minuten: null },
  ]);
  assert.deepEqual(d.pauschal.map((z) => [z.id, z.minuten, z.text]), [[1, 40, 'Belege verbuchen'], [2, 20, '']]);
  assert.deepEqual(d.extra.map((z) => [z.id, z.minuten, z.betrag]), [[3, 90, 195]]);
  assert.deepEqual(d.pauschalProLeistung, [{ leistung: 'Finanzbuchhaltung (Standard)', minuten: 40 }, { leistung: 'Übrige Arbeiten', minuten: 20 }]);
  assert.deepEqual(d.summen, { minutenPauschal: 60, minutenExtra: 90, betragExtra: 195, mwst: 15.8, total: 210.8 });
  assert.deepEqual(d.ids, [1, 2, 3]);
  assert.equal(rapportDaten([{ id: 1, datum: '2026-10-01', art: 'extra', minuten: 60, stundenansatz_chf: 100 }], { mwstPflichtig: false }).summen.total, 100);
});

test('Nummer und Stundentext', () => {
  assert.equal(naechsteRapportNummer([{ nummer: 'R-2026-03' }, { nummer: 'A-2026-09' }], 2026), 'R-2026-04');
  assert.equal(stundenText(150), '2:30 h');
});
