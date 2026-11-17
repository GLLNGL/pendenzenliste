import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monatsRaster, monatVerschieben, monatName, pendenzenAm, termineAm, zeitText } from '../src/lib/kalenderMonat.js';

test('Monatsraster: 6 Wochen ab Montag wie in Outlook', () => {
  const r = monatsRaster('2026-11');
  assert.equal(r.length, 42);
  assert.deepEqual([r[0].tag, r[0].imMonat], ['2026-10-26', false]);
  assert.deepEqual(r.find((x) => x.tag === '2026-11-17'), { tag: '2026-11-17', nummer: 17, imMonat: true });
  assert.equal(r[41].tag, '2026-12-06');
  assert.equal(monatVerschieben('2026-12', 1), '2027-01');
  assert.equal(monatVerschieben('2026-01', -1), '2025-12');
  assert.equal(monatName('2026-11'), 'November 2026');
});

test('Pendenzen eines Tages: Bearbeitungstag bzw. Nachfassdatum, ohne Projekt-Koepfe', () => {
  const offene = [
    { id: 1, titel: 'A', status: 'Offen', bearbeitungstag: '2026-11-18', mandant_name: 'Zeta' },
    { id: 2, titel: 'B', status: 'Warten auf', bearbeitungstag: '2026-11-10', wiedervorlage: '2026-11-18', mandant_name: 'Alpha' },
    { id: 3, titel: 'Projekt', status: 'Offen', bearbeitungstag: '2026-11-18', teilaufgaben_gesamt: 2 },
    { id: 4, titel: 'C', status: 'Offen', bearbeitungstag: '2026-11-19' },
    { id: 5, titel: 'D', status: 'Warten auf', bearbeitungstag: '2026-11-18', wiedervorlage: '2026-11-25' },
  ];
  assert.deepEqual(pendenzenAm(offene, '2026-11-18').map((p) => p.id), [2, 1]);
});

test('Termine eines Tages: Uhrzeit, ganztaegig und mehrtaegig', () => {
  const termine = [
    { betreff: 'Sitzung', start: '2026-11-17T14:00:00', ende: '2026-11-17T15:30:00', ganztag: false },
    { betreff: 'Ferien', start: '2026-11-16T00:00:00', ende: '2026-11-19T00:00:00', ganztag: true },
    { betreff: 'Morgen', start: '2026-11-18T09:00:00', ende: '2026-11-18T10:00:00', ganztag: false },
    { betreff: 'Frueh', start: '2026-11-17T08:00:00', ende: '2026-11-17T08:30:00', ganztag: false },
  ];
  assert.deepEqual(termineAm(termine, '2026-11-17').map((t) => t.betreff), ['Ferien', 'Frueh', 'Sitzung']);
  assert.deepEqual(termineAm(termine, '2026-11-19').map((t) => t.betreff), []);
  assert.equal(zeitText(termine[0], '2026-11-17'), '14:00–15:30');
  assert.equal(zeitText(termine[1], '2026-11-17'), 'ganztägig');
});
