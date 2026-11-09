import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datumErkennen, csvZerlegen, tabelleZaehlen, camtZaehlen, monateZusammen, kennzahlen } from '../src/lib/buchungsjournal.js';

test('Datum erkennen', () => {
  assert.equal(datumErkennen('03.11.2026'), '2026-11-03');
  assert.equal(datumErkennen('3.1.26'), '2026-01-03');
  assert.equal(datumErkennen('2026-11-03T00:00:00'), '2026-11-03');
  assert.equal(datumErkennen('03/11/2026'), '2026-11-03');
  assert.equal(datumErkennen(46329), '2026-11-03'); // Excel-Seriennummer
  assert.equal(datumErkennen(46023), '2026-01-01');
  assert.equal(datumErkennen('1250.50'), null);
  assert.equal(datumErkennen('Total'), null);
});

test('CSV zerlegen (Semikolon, Anführungszeichen)', () => {
  assert.deepEqual(csvZerlegen('Datum;Text;Betrag\n01.10.2026;"Miete; Oktober";-2000\n'), [['Datum', 'Text', 'Betrag'], ['01.10.2026', 'Miete; Oktober', '-2000']]);
});

test('Bankauszug: Zeilen mit Datum pro Monat', () => {
  const zeilen = csvZerlegen([
    'Kontoauszug UBS;;;',
    'Buchungsdatum;Valuta;Text;Betrag',
    '02.10.2026;02.10.2026;Miete;-2000',
    '15.10.2026;15.10.2026;Kunde A;500',
    '01.11.2026;01.11.2026;Kunde B;800',
    ';;Saldo;1300',
  ].join('\n'));
  const r = tabelleZaehlen(zeilen);
  assert.deepEqual(r.monate, [{ monat: '2026-10', anzahl: 2 }, { monat: '2026-11', anzahl: 1 }]);
  assert.match(r.methode, /Buchungsdatum/);
});

test('Buchungsjournal: gleiche Beleg-Nr. zählt einmal', () => {
  const zeilen = [
    ['Datum', 'Beleg', 'Soll', 'Haben', 'Betrag'],
    ['05.10.2026', '101', '6000', '1020', 100],
    ['05.10.2026', '101', '1170', '1020', 8.1], // Splitbuchung MWST
    ['06.10.2026', '102', '1020', '3200', 500],
    ['01.11.2026', '103', '6500', '1020', 50],
  ];
  const r = tabelleZaehlen(zeilen);
  assert.deepEqual(r.monate, [{ monat: '2026-10', anzahl: 2 }, { monat: '2026-11', anzahl: 1 }]);
  assert.match(r.methode, /Beleg-Nr/);
});

test('camt.053', () => {
  const xml = `<Document><BkToCstmrStmt><Stmt>
    <Ntry><Amt>1</Amt><BookgDt><Dt>2026-10-02</Dt></BookgDt><ValDt><Dt>2026-10-02</Dt></ValDt></Ntry>
    <Ntry><Amt>2</Amt><BookgDt><Dt>2026-10-20</Dt></BookgDt></Ntry>
    <Ntry><Amt>3</Amt><ValDt><Dt>2026-11-01</Dt></ValDt></Ntry>
  </Stmt></BkToCstmrStmt></Document>`;
  assert.deepEqual(camtZaehlen(xml).monate, [{ monat: '2026-10', anzahl: 2 }, { monat: '2026-11', anzahl: 1 }]);
  assert.equal(camtZaehlen('<Document/>'), null);
});

test('Kennzahlen mit Lücke und mehreren Dateien', () => {
  const monate = monateZusammen([[{ monat: '2026-01', anzahl: 40 }], [{ monat: '2026-03', anzahl: 50 }, { monat: '2026-01', anzahl: 2 }]]);
  const k = kennzahlen(monate);
  assert.deepEqual(k.monate.map((m) => m.anzahl), [42, 0, 50]);
  assert.equal(k.total, 92);
  assert.equal(k.durchschnitt, 30.7);
  assert.equal(k.maximum, 50);
  assert.equal(kennzahlen([]), null);
});
