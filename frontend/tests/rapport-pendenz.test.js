import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nachPendenz } from '../src/lib/rapport.js';

test('Rapport nach Pendenz: Schritte unter dem Projekt, Art und Betrag', () => {
  const pendenzen = [
    { id: 10, titel: 'Jahresabschluss 2025', uebergeordnete_pendenz_id: null },
    { id: 11, titel: 'Belege anfordern', uebergeordnete_pendenz_id: 10, eltern_titel: 'Jahresabschluss 2025' },
    { id: 20, titel: 'MWST Q3', uebergeordnete_pendenz_id: null },
  ];
  const eintraege = [
    { id: 1, pendenz_id: 11, art: 'pauschal', minuten: 28 },
    { id: 2, pendenz_id: 10, art: 'pauschal', minuten: 60 },
    { id: 3, pendenz_id: 20, art: 'extra', minuten: 30, stundenansatz_chf: 130 },
    { id: 4, pendenz_id: 20, art: 'pauschal', minuten: 10 },
    { id: 5, pendenz_id: null, art: 'extra', minuten: 60, stundenansatz_chf: 130, beschreibung: 'Telefon Kunde' },
    { id: 6, pendenz_id: null, art: 'intern', minuten: 99 },
    { id: 7, pendenz_id: 10, art: 'pauschal', minuten: null },
  ];
  const g = nachPendenz(eintraege, pendenzen);
  assert.deepEqual(g.map((x) => [x.titel, x.pendenzId, x.minuten, x.art, x.betrag]), [
    ['Jahresabschluss 2025', 10, 90, 'pauschal', 0],
    ['MWST Q3', 20, 40, 'gemischt', 65],
    ['Telefon Kunde', null, 60, 'extra', 130],
  ]);
  assert.equal(g[0].eintraege.find((e) => e.id === 1).schrittTitel, 'Belege anfordern');
});
