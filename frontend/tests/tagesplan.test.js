import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagesplan, zuPlanen, morgenTitel } from '../src/lib/tagesplan.js';

const heute = '2026-11-06'; // Freitag
const p = (id, felder) => ({ id, titel: `P${id}`, status: 'Offen', prioritaet: 'B', geplant: true, ...felder });

test('Heute, Morgen (nächster Arbeitstag) und Wochenziele', () => {
  const offene = [
    p(1, { bearbeitungstag: heute }),
    p(2, { faelligkeit: '2026-11-02' }), // überfällig
    p(3, { status: 'In Arbeit' }),
    p(4, { bearbeitungstag: '2026-11-09' }), // Montag = nächster Arbeitstag
    p(5, { faelligkeit: '2026-11-09', bearbeitungstag: '2026-11-20' }),
    p(6, { status: 'Warten auf', wiedervorlage: '2026-11-10' }),
    p(7, { teilaufgaben_gesamt: 3, bearbeitungstag: heute }), // Projekt-Kopf zählt nicht
    p(8, { bearbeitungstag: heute, bearbeiter_id: 99 }), // andere Person
    p(9, { wochenziel_woche: '2026-11-02' }),
  ];
  const erledigte = [
    p(10, { status: 'Erledigt', erledigt_am: heute }),
    p(11, { status: 'Erledigt', erledigt_am: '2026-11-04', wochenziel_woche: '2026-11-02' }),
  ];
  const t = tagesplan(offene, erledigte, { heute, ichId: 1 });
  assert.deepEqual(t.heute.offen.map((x) => x.id).sort(), [1, 2, 3]);
  assert.deepEqual(t.heute.erledigt.map((x) => x.id), [10]);
  assert.equal(t.morgen.tag, '2026-11-09');
  assert.deepEqual(t.morgen.offen.map((x) => x.id).sort(), [4, 5]);
  assert.deepEqual(t.wochenziele.offen.map((x) => x.id), [9]);
  assert.deepEqual(t.wochenziele.erledigt.map((x) => x.id), [11]);
});

test('Zu planen: offen ohne Bearbeitungstag, ohne Projekt-Köpfe', () => {
  const liste = zuPlanen([
    p(1, {}), p(2, { faelligkeit: '2026-12-01' }), p(3, { bearbeitungstag: heute }),
    p(4, { status: 'Warten auf' }), p(5, { status: 'Später' }), p(6, { teilaufgaben_gesamt: 2 }),
  ]);
  assert.deepEqual(liste.map((x) => x.id).sort(), [1, 2, 5]);
});

test('Titel für den nächsten Arbeitstag', () => {
  assert.equal(morgenTitel('2026-11-05', '2026-11-06'), 'Morgen');
  assert.equal(morgenTitel('2026-11-06', '2026-11-09'), 'Montag');
});
