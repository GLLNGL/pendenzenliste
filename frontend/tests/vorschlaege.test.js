import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockVorschlag, plusArbeitstage, minusArbeitstage, prioritaetVorschlag } from '../src/lib/vorschlaege.js';

test('Block-Vorschlag aus dem nächsten Schritt', () => {
  assert.equal(blockVorschlag('MWST-Abrechnung Q3 in Abacus abstimmen'), 'MWST');
  assert.equal(blockVorschlag('Lohnlauf Oktober freigeben'), 'Lohn');
  assert.equal(blockVorschlag('Zahlungslauf Kreditoren erstellen'), 'Zahlungen');
  assert.equal(blockVorschlag('Mahnlauf 2. Stufe versenden'), 'Debitoren');
  assert.equal(blockVorschlag('Jahresabschluss 2025: Bilanzkonten abstimmen'), 'Abschluss');
  assert.equal(blockVorschlag('Ordnerstruktur anlegen'), 'Admin');
  assert.equal(blockVorschlag('Kunde zurückrufen'), null);
  assert.equal(blockVorschlag(''), null);
});

test('MWST hat Vorrang vor Abschluss (wie in der Migration)', () => {
  assert.equal(blockVorschlag('Jahresabstimmung MWSt 2025'), 'MWST');
});

test('Arbeitstage überspringen Wochenenden', () => {
  // Mi 04.11.2026 + 5 Arbeitstage = Mi 11.11.2026
  assert.equal(plusArbeitstage('2026-11-04', 5), '2026-11-11');
  // Fr 06.11.2026 + 1 Arbeitstag = Mo 09.11.2026
  assert.equal(plusArbeitstage('2026-11-06', 1), '2026-11-09');
  // Mo 09.11.2026 - 2 Arbeitstage = Do 05.11.2026
  assert.equal(minusArbeitstage('2026-11-09', 2), '2026-11-05');
});

test('Priorität A nur bei harter Frist in ≤ 5 Arbeitstagen', () => {
  const heute = '2026-11-04';
  assert.equal(prioritaetVorschlag({ faelligkeit: '2026-11-11', harteFrist: true }, heute), 'A');
  assert.equal(prioritaetVorschlag({ faelligkeit: '2026-11-12', harteFrist: true }, heute), null);
  assert.equal(prioritaetVorschlag({ faelligkeit: '2026-11-01', harteFrist: true }, heute), 'A'); // überfällig
  assert.equal(prioritaetVorschlag({ faelligkeit: '2026-11-05', harteFrist: false }, heute), null);
});
