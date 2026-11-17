import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xlsxBytes, crc32, seriennummer, spaltenName } from '../src/lib/xlsx.js';
import { createRequire } from 'node:module';
import { dateiname, listeAufbauen, pendenzenlisteBlaetter } from '../src/lib/pendenzenliste.js';
import { protokollPdf, sauber } from '../src/lib/protokollPdf.js';

const jspdf = createRequire(import.meta.url)('jspdf');

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

const PENDENZEN = [
  { id: 1, titel: 'Jahresabschluss', status: 'Offen', teilaufgaben_gesamt: 2, faelligkeit: '2026-12-31' },
  { id: 2, titel: 'Belege anfordern', status: 'Erledigt', uebergeordnete_pendenz_id: 1, eltern_titel: 'Jahresabschluss', erledigt_am: '2026-11-10', reihenfolge: 1, bearbeiter_name: 'Angelo' },
  { id: 3, titel: 'Abschluss buchen', status: 'Später', uebergeordnete_pendenz_id: 1, eltern_titel: 'Jahresabschluss', reihenfolge: 2, faelligkeit: '2026-12-15' },
  { id: 4, titel: 'MWST Q3', status: 'Warten auf', warten_auf_person: 'Kunde', bearbeitungstag: '2026-11-20', teilaufgaben_gesamt: 0 },
  { id: 5, titel: 'Alt', status: 'Erledigt', erledigt_am: '2026-01-01', teilaufgaben_gesamt: 0 },
  { id: 9, titel: 'Teil eines alten Projekts', status: 'Offen', uebergeordnete_pendenz_id: 8, eltern_titel: 'Altprojekt', reihenfolge: 3 },
];
const ZEITEN = [
  { id: 11, pendenz_id: 2, datum: '2026-11-09', minuten: 90, beschreibung: 'Belege beim Kunden angefordert', art: 'pauschal' },
  { id: 12, pendenz_id: 2, datum: '2026-11-10', minuten: 30, beschreibung: 'Nachfassen', art: 'extra' },
  { id: 13, pendenz_id: 3, datum: '2026-11-12', minuten: 45, beschreibung: 'intern besprochen', art: 'intern' },
  { id: 14, pendenz_id: 4, datum: '2026-11-11', minuten: null, beschreibung: 'laeuft', art: 'pauschal' },
];
const NOTIZEN = [{ id: 21, pendenz_id: 3, text: 'Warten auf Kontoauszug Dezember', erstellt_am: '2026-11-13T09:00:00Z' }];

test('Pendenzenliste: gegliedert nach Projekt, Teilaufgabe und Taetigkeit', () => {
  const l = listeAufbauen(PENDENZEN, '2026-11-17', ZEITEN, NOTIZEN);
  assert.deepEqual(l.projekte.map((p) => [p.id, p.titel, p.erledigt, p.minuten]), [
    [8, 'Altprojekt', false, 0], [1, 'Jahresabschluss', false, 120], [4, 'MWST Q3', false, 0],
  ]);
  const ja = l.projekte[1];
  assert.deepEqual(ja.schritte.map((s) => [s.nr, s.titel, s.status, s.datum, s.minuten]), [
    [1, 'Belege anfordern', 'Erledigt', '2026-11-10', 120], [2, 'Abschluss buchen', 'Offen', null, 0],
  ]);
  assert.deepEqual(ja.schritte[0].taetigkeiten.map((t) => [t.datum, t.text, t.minuten, t.art]), [
    ['2026-11-09', 'Belege beim Kunden angefordert', 90, 'Pauschal'], ['2026-11-10', 'Nachfassen', 30, 'Extra'],
  ]);
  // interne Zeit faellt weg, Statusnotiz bleibt (ohne Zeit)
  assert.deepEqual(ja.schritte[1].taetigkeiten.map((t) => [t.datum, t.text, t.minuten]), [['2026-11-13', 'Warten auf Kontoauszug Dezember', null]]);
  assert.equal(l.projekte[0].schritte[0].nr, 1);
  assert.equal(l.projekte[2].status, 'Warten auf Kunde');
  assert.deepEqual(l.summen, { minuten: 120, pauschal: 90, extra: 30 });
  assert.equal(l.anzahlOffen, 3);
});

test('Pendenzenliste: Excel eine Zeile pro Aufgabe, Arbeiten zusammengefasst', () => {
  const { blaetter } = pendenzenlisteBlaetter({ name: 'A4 Personal AG' }, PENDENZEN, '2026-11-17', ZEITEN, NOTIZEN);
  assert.equal(blaetter.length, 1);
  const z = blaetter[0].zeilen.slice(4);
  assert.deepEqual(z.map((r) => r[1].wert), ['Altprojekt', '1. Teil eines alten Projekts', 'Jahresabschluss', '1. Belege anfordern', '2. Abschluss buchen', 'MWST Q3']);
  const belege = z[3];
  assert.equal(belege[2].stil, 'statusErledigt');
  assert.equal(belege[5].wert, '09.11.  Belege beim Kunden angefordert (1:30 h, Pauschal)\n10.11.  Nachfassen (0:30 h, Extra)');
  assert.deepEqual([belege[6].wert, belege[7].wert, belege[8].stil], [2, 'Pauschal + Extra', 'eingabe']);
  assert.equal(z[4][5].wert, '13.11.  Warten auf Kontoauszug Dezember');
  assert.equal(z[5][2].stil, 'statusWarten');
  assert.equal(blaetter[0].fixiereZeilen, 4);
  assert.ok(xlsxBytes(blaetter, new Date(2026, 10, 17)).length > 1000);
});

test('Protokoll-PDF: ausfuellbare Bemerkungsfelder fuer offene Aufgaben', () => {
  const liste = listeAufbauen(PENDENZEN, '2026-11-17', ZEITEN, NOTIZEN);
  const { doc, felder, name, seiten } = protokollPdf(jspdf, { mandant: { name: 'Müller & Co' }, liste, heute: '2026-11-17', firma: { firma: 'EST Controlling' }, bearbeiter: 'Angelo' });
  assert.equal(name, '20261117_Protokoll_Müller & Co.pdf');
  // 3 offene Aufgaben + allgemeine Bemerkungen + Name + Ort/Datum
  assert.equal(felder, 6);
  assert.ok(seiten >= 1);
  const pdf = doc.output();
  assert.ok(pdf.includes('/T (bemerkung_3)'));
  assert.ok(pdf.includes('/T (bemerkungen_allgemein)'));
  assert.ok(!pdf.includes('(bemerkung_2)'));
  assert.equal(sauber('MWST → prüfen ✓ «ok»'), 'MWST -> prüfen ok «ok»');
});
