import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abgelaufene, tageZwischen } from '../src/lib/tagesplan.js';

const heute = '2026-11-09';
const p = (id, felder) => ({ id, titel: `P${id}`, status: 'Offen', prioritaet: 'B', geplant: true, ...felder });

test('Abgelaufen: Frist, alter Bearbeitungstag, Nachfassen; verschobene bleiben sichtbar', () => {
  const offene = [
    p(1, { faelligkeit: '2026-11-02' }),
    p(2, { faelligkeit: '2026-11-05', bearbeitungstag: '2026-11-16' }), // verschoben, Frist trotzdem vorbei
    p(3, { bearbeitungstag: '2026-11-06' }), // geplant, nicht erledigt
    p(4, { status: 'Warten auf', wiedervorlage: '2026-11-04', bearbeitungstag: '2026-11-01' }),
    p(5, { faelligkeit: heute }), // heute fällig = noch nicht abgelaufen
    p(6, { faelligkeit: '2026-11-01', status: 'Erledigt' }),
    p(7, { faelligkeit: '2026-11-01', geplant: false }), // Eingang
    p(8, { faelligkeit: '2026-11-01', bearbeiter_id: 99 }), // andere Person
    p(10, { teilaufgaben_gesamt: 2, faelligkeit: '2026-10-30' }), // Projekt abgelaufen
    p(11, { uebergeordnete_pendenz_id: 10 }),
    p(12, { uebergeordnete_pendenz_id: 10, status: 'Erledigt' }),
  ];
  const liste = abgelaufene(offene, { heute, ichId: 1 });
  assert.deepEqual(liste.map((x) => x.id), [11, 1, 4, 2, 3]);
  assert.equal(liste.find((x) => x.id === 4).abgelaufen.art, 'nachfassen');
  assert.equal(liste.find((x) => x.id === 3).abgelaufen.art, 'geplant');
  assert.equal(liste.find((x) => x.id === 11).abgelaufen.datum, '2026-10-30');
});

test('Tage zwischen zwei Daten', () => {
  assert.equal(tageZwischen('2026-11-02', heute), 7);
  assert.equal(tageZwischen('2026-10-30', '2026-11-02'), 3);
});
