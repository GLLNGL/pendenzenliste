import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xlsxBytes, crc32, seriennummer, spaltenName } from '../src/lib/xlsx.js';
import { dateiname, listeAufbauen, pendenzenlisteBlaetter } from '../src/lib/pendenzenliste.js';

// Minimaler ZIP-Leser fuer den Test (stored).
function zipLesen(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let ende = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) if (v.getUint32(i, true) === 0x06054b50) { ende = i; break; }
  const anzahl = v.getUint16(ende + 10, true);
  let pos = v.getUint32(ende + 16, true);
  const dateien = new Map();
  for (let i = 0; i < anzahl; i += 1) {
    const crc = v.getUint32(pos + 16, true);
    const groesse = v.getUint32(pos + 20, true);
    const nameLaenge = v.getUint16(pos + 28, true);
    const lokal = v.getUint32(pos + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + nameLaenge));
    const start = lokal + 30 + v.getUint16(lokal + 26, true);
    const daten = bytes.subarray(start, start + groesse);
    assert.equal(crc32(daten), crc, `CRC ${name}`);
    dateien.set(name, new TextDecoder().decode(daten));
    pos += 46 + nameLaenge;
  }
  return dateien;
}

test('xlsx: Hilfsfunktionen', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  assert.equal(seriennummer('2026-11-17'), 46343);
  assert.equal(seriennummer('1900-03-01'), 61);
  assert.deepEqual([0, 25, 26, 27, 701].map(spaltenName), ['A', 'Z', 'AA', 'AB', 'ZZ']);
});

test('xlsx: Paket mit Blaettern, Texten, Datum und Filter', () => {
  const bytes = xlsxBytes([{ name: 'Offen', spalten: [{ breite: 10 }], zeilen: [[{ wert: 'Nr.', stil: 'kopf' }, 'A & <B>'], [1, { datum: '2026-11-17' }]], fixiereZeilen: 1, filter: 'A1:B2' }],
    new Date(2026, 10, 17, 10, 0, 0));
  const d = zipLesen(bytes);
  assert.deepEqual([...d.keys()], ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']);
  const blatt = d.get('xl/worksheets/sheet1.xml');
  assert.match(blatt, /<c r="B1" t="inlineStr"><is><t xml:space="preserve">A &amp; &lt;B&gt;<\/t><\/is><\/c>/);
  assert.match(blatt, /<c r="A2"><v>1<\/v><\/c><c r="B2" s="4"><v>46343<\/v><\/c>/);
  assert.match(blatt, /<autoFilter ref="A1:B2"\/>/);
  assert.match(d.get('xl/workbook.xml'), /'Offen'!\$A\$1:\$B\$2/);
});

test('Pendenzenliste: Dateiname mit Datum und Mandant', () => {
  assert.equal(dateiname('A4 Personal AG', '2026-11-17'), '20261117_Pendenzenliste_A4 Personal AG.xlsx');
  assert.equal(dateiname('Müller / Partner: GmbH', '2026-01-05'), '20260105_Pendenzenliste_Müller Partner GmbH.xlsx');
});

test('Pendenzenliste: Projekte als Teilaufgaben, erledigte der letzten 90 Tage', () => {
  const p = [
    { id: 1, titel: 'Jahresabschluss', status: 'Offen', teilaufgaben_gesamt: 2 },
    { id: 2, titel: 'Belege anfordern', status: 'Erledigt', uebergeordnete_pendenz_id: 1, eltern_titel: 'Jahresabschluss', erledigt_am: '2026-11-10', reihenfolge: 1, bearbeiter_name: 'Angelo' },
    { id: 3, titel: 'Abschluss buchen', status: 'Später', uebergeordnete_pendenz_id: 1, eltern_titel: 'Jahresabschluss', reihenfolge: 2, faelligkeit: '2026-12-15' },
    { id: 4, titel: 'MWST Q3', status: 'Warten auf', warten_auf_person: 'Kunde', bearbeitungstag: '2026-11-20', teilaufgaben_gesamt: 0 },
    { id: 5, titel: 'Alt', status: 'Erledigt', erledigt_am: '2026-01-01', teilaufgaben_gesamt: 0 },
  ];
  const l = listeAufbauen(p, '2026-11-17');
  assert.deepEqual(l.offen.map((z) => [z.id, z.projekt, z.aufgabe, z.status, z.frist, z.bearbeitenAm]), [
    [3, 'Jahresabschluss', 'Abschluss buchen', 'Offen', '2026-12-15', null],
    [4, 'MWST Q3', '', 'Warten auf Kunde', null, '2026-11-20'],
  ]);
  assert.deepEqual(l.erledigt.map((z) => [z.id, z.erledigtAm, z.verantwortlich]), [[2, '2026-11-10', 'Angelo']]);
  const { blaetter } = pendenzenlisteBlaetter({ name: 'A4 Personal AG' }, p, '2026-11-17');
  assert.equal(blaetter[0].zeilen.length, 3 + 1 + 2);
  assert.equal(blaetter[0].filter, 'A4:I6');
  assert.equal(blaetter[0].fixiereZeilen, 4);
});
