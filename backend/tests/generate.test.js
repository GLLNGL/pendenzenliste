import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generiereFaelligePendenzen } from '../src/generate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function frischeTestDb() {
  const db = new DatabaseSync(':memory:');
  const schema = readFileSync(join(__dirname, '..', 'src', 'schema.sql'), 'utf-8');
  db.exec(schema);
  return db;
}

function fuegeMonatlicheRegelEin(db, { tag = 25, vorlauf = 7 } = {}) {
  db.prepare(`
    INSERT INTO wiederkehr_regeln
      (titel_vorlage, mandant_id, rhythmus, faelligkeit_typ, faelligkeit_config, vorlauf_tage, aktiv)
    VALUES ('Lohnlauf {Monat} {Jahr}', NULL, 'monatlich', 'tag_des_monats', ?, ?, 1)
  `).run(JSON.stringify({ tag }), vorlauf);
}

// Quartalsweise Regel: Perioden liegen ~90 Tage auseinander, also weiter als das
// 45-Tage-Nachtragsfenster -- geeignet fuer Tests, die genau eine Pendenz pruefen wollen,
// ohne dass die Vorperiode ungewollt mit hineinspielt (siehe monatliche Tests weiter unten).
function fuegeQuartalsweiseRegelEin(db, { tageNachEnde = 60, vorlauf = 30 } = {}) {
  db.prepare(`
    INSERT INTO wiederkehr_regeln
      (titel_vorlage, mandant_id, rhythmus, faelligkeit_typ, faelligkeit_config, vorlauf_tage, aktiv)
    VALUES ('MWST-Abrechnung {Quartal} {Jahr}', NULL, 'quartalsweise', 'tage_nach_periodenende', ?, ?, 1)
  `).run(JSON.stringify({ tage: tageNachEnde }), vorlauf);
}

describe('generiereFaelligePendenzen', () => {
  let db;
  beforeEach(() => {
    db = frischeTestDb();
  });

  test('erzeugt eine Pendenz, sobald das Erscheinungsdatum erreicht ist', () => {
    // Q1 2026 endet 31.03., Faelligkeit 60 Tage danach = 30.05., Vorlauf 30 Tage -> sichtbar ab 30.04.
    fuegeQuartalsweiseRegelEin(db, { tageNachEnde: 60, vorlauf: 30 });
    const heute = new Date(Date.UTC(2026, 4, 1)); // 01.05.2026
    const erzeugt = generiereFaelligePendenzen(db, heute);
    assert.equal(erzeugt, 1);
    const rows = db.prepare('SELECT titel, faelligkeit FROM pendenzen').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].titel, 'MWST-Abrechnung Q1 2026');
    assert.equal(rows[0].faelligkeit, '2026-05-30');
  });

  test('erzeugt noch nichts, bevor das Erscheinungsdatum (Faelligkeit - Vorlauf) erreicht ist', () => {
    fuegeQuartalsweiseRegelEin(db, { tageNachEnde: 60, vorlauf: 30 });
    const heute = new Date(Date.UTC(2026, 3, 20)); // 20.04.2026, Erscheinen erst ab 30.04.
    const erzeugt = generiereFaelligePendenzen(db, heute);
    assert.equal(erzeugt, 0);
  });

  test('ist idempotent: mehrfacher Lauf am selben Tag erzeugt keine Duplikate', () => {
    fuegeQuartalsweiseRegelEin(db, { tageNachEnde: 60, vorlauf: 30 });
    const heute = new Date(Date.UTC(2026, 4, 1));
    generiereFaelligePendenzen(db, heute);
    generiereFaelligePendenzen(db, heute);
    generiereFaelligePendenzen(db, heute);
    const rows = db.prepare('SELECT * FROM pendenzen').all();
    assert.equal(rows.length, 1);
  });

  test('ist idempotent ueber mehrere Tage hinweg (kein Duplikat der gleichen Periode)', () => {
    fuegeMonatlicheRegelEin(db, { tag: 25, vorlauf: 7 });
    generiereFaelligePendenzen(db, new Date(Date.UTC(2026, 3, 19)));
    const anzahlNachErstemLauf = db.prepare('SELECT COUNT(*) AS n FROM pendenzen').get().n;
    generiereFaelligePendenzen(db, new Date(Date.UTC(2026, 3, 20)));
    generiereFaelligePendenzen(db, new Date(Date.UTC(2026, 3, 25)));
    const rows = db.prepare('SELECT * FROM pendenzen').all();
    assert.equal(rows.length, anzahlNachErstemLauf);
  });

  test('erzeugt in aufeinanderfolgenden Monaten separate Pendenzen (kein Duplikat ueber Perioden)', () => {
    fuegeMonatlicheRegelEin(db, { tag: 25, vorlauf: 7 });
    // Beim ersten Lauf wird die Vorperiode (Maerz) innerhalb des 45-Tage-Nachtragsfensters
    // ebenfalls miterzeugt -- das ist beabsichtigt (siehe NACHTRAGSFENSTER_TAGE in generate.js).
    generiereFaelligePendenzen(db, new Date(Date.UTC(2026, 3, 19))); // April-Periode
    const erzeugtMai = generiereFaelligePendenzen(db, new Date(Date.UTC(2026, 4, 19))); // Mai-Periode
    assert.equal(erzeugtMai, 1);
    const rows = db.prepare('SELECT faelligkeit FROM pendenzen ORDER BY faelligkeit').all();
    assert.deepEqual(rows.map((r) => r.faelligkeit), ['2026-03-25', '2026-04-25', '2026-05-25']);
  });

  test('respektiert inaktive Regeln', () => {
    fuegeMonatlicheRegelEin(db, { tag: 25, vorlauf: 7 });
    db.prepare('UPDATE wiederkehr_regeln SET aktiv = 0').run();
    const erzeugt = generiereFaelligePendenzen(db, new Date(Date.UTC(2026, 3, 19)));
    assert.equal(erzeugt, 0);
  });

  test('Quartalswechsel: MWST-Regel erzeugt am Jahresende korrekt die Q4-Pendenz', () => {
    db.prepare(`
      INSERT INTO wiederkehr_regeln
        (titel_vorlage, mandant_id, rhythmus, faelligkeit_typ, faelligkeit_config, vorlauf_tage, aktiv)
      VALUES ('MWST-Abrechnung {Quartal} {Jahr}', NULL, 'quartalsweise', 'tage_nach_periodenende', ?, 30, 1)
    `).run(JSON.stringify({ tage: 60 }));
    // Q4 2025 endet 31.12.2025, Faelligkeit 60 Tage danach = 01.03.2026, Vorlauf 30 Tage -> ab 30.01.2026 sichtbar.
    const erzeugt = generiereFaelligePendenzen(db, new Date(Date.UTC(2026, 1, 5)));
    assert.equal(erzeugt, 1);
    const row = db.prepare('SELECT titel, faelligkeit FROM pendenzen').get();
    assert.equal(row.titel, 'MWST-Abrechnung Q4 2025');
    assert.equal(row.faelligkeit, '2026-03-01');
  });

  test('bereits manuell/vorab vorhandene Regel+Periode-Kombination wird nicht erneut erzeugt', () => {
    fuegeMonatlicheRegelEin(db, { tag: 25, vorlauf: 7 });
    const regelId = db.prepare('SELECT id FROM wiederkehr_regeln').get().id;
    db.prepare(`
      INSERT INTO pendenzen (titel, faelligkeit, prioritaet, status, erstellt_am, regel_id, perioden_schluessel)
      VALUES ('Manuell bereits erledigt', '2026-04-25', 'Mittel', 'Erledigt', '2026-04-01T00:00:00.000Z', ?, '2026-04')
    `).run(regelId);
    generiereFaelligePendenzen(db, new Date(Date.UTC(2026, 3, 19)));
    // Fuer die April-Periode darf trotz Lauf kein zweiter Eintrag entstehen (die manuell
    // vorhandene Zeile zaehlt als bereits erzeugt); die Vorperiode Maerz darf regulaer dazukommen.
    const aprilRows = db.prepare("SELECT * FROM pendenzen WHERE perioden_schluessel = '2026-04'").all();
    assert.equal(aprilRows.length, 1);
    assert.equal(aprilRows[0].titel, 'Manuell bereits erledigt');
  });

  test('UNIQUE-Index verhindert Duplikate auch bei direktem Insert-Versuch', () => {
    fuegeMonatlicheRegelEin(db, { tag: 25, vorlauf: 7 });
    const regelId = db.prepare('SELECT id FROM wiederkehr_regeln').get().id;
    const insert = () => db.prepare(`
      INSERT INTO pendenzen (titel, faelligkeit, prioritaet, status, erstellt_am, regel_id, perioden_schluessel)
      VALUES ('X', '2026-04-25', 'Mittel', 'Offen', '2026-04-01T00:00:00.000Z', ?, '2026-04')
    `).run(regelId);
    insert();
    assert.throws(insert);
  });
});
