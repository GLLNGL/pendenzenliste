import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { leiteHauptaufgabenStatusAb, kaskadiereAnTeilaufgaben, synchronisiereVerknuepfteAufgaben } from '../src/routes/pendenzen.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function frischeTestDb() {
  const db = new DatabaseSync(':memory:');
  const schema = readFileSync(join(__dirname, '..', 'src', 'schema.sql'), 'utf-8');
  db.exec(schema);
  return db;
}

function fuegePendenzEin(db, { titel = 'Test', status = 'Offen', uebergeordnetePendenzId = null } = {}) {
  const info = db.prepare(`
    INSERT INTO pendenzen (titel, faelligkeit, status, erstellt_am, uebergeordnete_pendenz_id)
    VALUES (?, '2026-01-15', ?, '2026-01-01T00:00:00.000Z', ?)
  `).run(titel, status, uebergeordnetePendenzId);
  return info.lastInsertRowid;
}

function statusVon(db, id) {
  return db.prepare('SELECT status FROM pendenzen WHERE id = ?').get(id).status;
}

describe('leiteHauptaufgabenStatusAb (bottom-up)', () => {
  test('alle Teilaufgaben offen -> Hauptaufgabe offen', () => {
    const db = frischeTestDb();
    const hauptId = fuegePendenzEin(db, { titel: 'Haupt', status: 'Offen' });
    fuegePendenzEin(db, { titel: 'Teil 1', status: 'Offen', uebergeordnetePendenzId: hauptId });
    fuegePendenzEin(db, { titel: 'Teil 2', status: 'Offen', uebergeordnetePendenzId: hauptId });

    leiteHauptaufgabenStatusAb(db, hauptId);
    assert.equal(statusVon(db, hauptId), 'Offen');
  });

  test('eine Teilaufgabe nicht mehr offen, nicht alle erledigt -> Hauptaufgabe "In Arbeit"', () => {
    const db = frischeTestDb();
    const hauptId = fuegePendenzEin(db, { titel: 'Haupt', status: 'Offen' });
    const teil1 = fuegePendenzEin(db, { titel: 'Teil 1', status: 'Offen', uebergeordnetePendenzId: hauptId });
    fuegePendenzEin(db, { titel: 'Teil 2', status: 'Offen', uebergeordnetePendenzId: hauptId });

    db.prepare('UPDATE pendenzen SET status = ? WHERE id = ?').run('Erledigt', teil1);
    leiteHauptaufgabenStatusAb(db, hauptId);

    assert.equal(statusVon(db, hauptId), 'In Arbeit');
  });

  test('alle Teilaufgaben erledigt -> Hauptaufgabe erledigt (mit erledigt_am)', () => {
    const db = frischeTestDb();
    const hauptId = fuegePendenzEin(db, { titel: 'Haupt', status: 'In Arbeit' });
    fuegePendenzEin(db, { titel: 'Teil 1', status: 'Erledigt', uebergeordnetePendenzId: hauptId });
    const teil2 = fuegePendenzEin(db, { titel: 'Teil 2', status: 'Offen', uebergeordnetePendenzId: hauptId });
    db.prepare('UPDATE pendenzen SET status = ? WHERE id = ?').run('Erledigt', teil2);

    leiteHauptaufgabenStatusAb(db, hauptId);

    const haupt = db.prepare('SELECT status, erledigt_am FROM pendenzen WHERE id = ?').get(hauptId);
    assert.equal(haupt.status, 'Erledigt');
    assert.ok(haupt.erledigt_am);
  });

  test('Hauptaufgabe ohne Teilaufgaben bleibt unveraendert', () => {
    const db = frischeTestDb();
    const hauptId = fuegePendenzEin(db, { titel: 'Haupt', status: 'Warte auf Kunde' });
    leiteHauptaufgabenStatusAb(db, hauptId);
    assert.equal(statusVon(db, hauptId), 'Warte auf Kunde');
  });
});

describe('kaskadiereAnTeilaufgaben (top-down)', () => {
  test('Hauptaufgabe manuell auf erledigt -> alle Teilaufgaben erledigt', () => {
    const db = frischeTestDb();
    const hauptId = fuegePendenzEin(db, { titel: 'Haupt', status: 'In Arbeit' });
    const teil1 = fuegePendenzEin(db, { titel: 'Teil 1', status: 'Offen', uebergeordnetePendenzId: hauptId });
    const teil2 = fuegePendenzEin(db, { titel: 'Teil 2', status: 'Erledigt', uebergeordnetePendenzId: hauptId });

    kaskadiereAnTeilaufgaben(db, hauptId, 'Erledigt');

    assert.equal(statusVon(db, teil1), 'Erledigt');
    assert.equal(statusVon(db, teil2), 'Erledigt');
  });

  test('Hauptaufgabe zurueck auf offen -> alle Teilaufgaben zurueck auf offen', () => {
    const db = frischeTestDb();
    const hauptId = fuegePendenzEin(db, { titel: 'Haupt', status: 'Erledigt' });
    const teil1 = fuegePendenzEin(db, { titel: 'Teil 1', status: 'Erledigt', uebergeordnetePendenzId: hauptId });
    const teil2 = fuegePendenzEin(db, { titel: 'Teil 2', status: 'Erledigt', uebergeordnetePendenzId: hauptId });

    kaskadiereAnTeilaufgaben(db, hauptId, 'Offen');

    assert.equal(statusVon(db, teil1), 'Offen');
    assert.equal(statusVon(db, teil2), 'Offen');
  });

  test('Hauptaufgabe zurueck auf "In Arbeit" setzt Teilaufgaben ebenfalls auf offen', () => {
    const db = frischeTestDb();
    const hauptId = fuegePendenzEin(db, { titel: 'Haupt', status: 'Erledigt' });
    const teil1 = fuegePendenzEin(db, { titel: 'Teil 1', status: 'Erledigt', uebergeordnetePendenzId: hauptId });

    kaskadiereAnTeilaufgaben(db, hauptId, 'In Arbeit');

    assert.equal(statusVon(db, teil1), 'Offen');
  });
});

describe('synchronisiereVerknuepfteAufgaben (Weiche je nach Rolle)', () => {
  test('Aenderung an einer Teilaufgabe leitet den Status der Hauptaufgabe ab', () => {
    const db = frischeTestDb();
    const hauptId = fuegePendenzEin(db, { titel: 'Haupt', status: 'Offen' });
    const teil1 = fuegePendenzEin(db, { titel: 'Teil 1', status: 'Offen', uebergeordnetePendenzId: hauptId });
    const teilVorAenderung = db.prepare('SELECT * FROM pendenzen WHERE id = ?').get(teil1);

    db.prepare('UPDATE pendenzen SET status = ? WHERE id = ?').run('Erledigt', teil1);
    synchronisiereVerknuepfteAufgaben(db, teilVorAenderung, 'Erledigt');

    assert.equal(statusVon(db, hauptId), 'Erledigt');
  });

  test('Aenderung an der Hauptaufgabe kaskadiert an die Teilaufgaben', () => {
    const db = frischeTestDb();
    const hauptId = fuegePendenzEin(db, { titel: 'Haupt', status: 'Offen' });
    const teil1 = fuegePendenzEin(db, { titel: 'Teil 1', status: 'Offen', uebergeordnetePendenzId: hauptId });
    const hauptVorAenderung = db.prepare('SELECT * FROM pendenzen WHERE id = ?').get(hauptId);

    db.prepare('UPDATE pendenzen SET status = ? WHERE id = ?').run('Erledigt', hauptId);
    synchronisiereVerknuepfteAufgaben(db, hauptVorAenderung, 'Erledigt');

    assert.equal(statusVon(db, teil1), 'Erledigt');
  });
});
