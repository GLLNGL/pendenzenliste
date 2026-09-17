import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Leichte Migration fuer Datenbanken, die vor Einfuehrung der Teilaufgaben-Funktion
// angelegt wurden: fehlende Spalte ergaenzen, ohne bestehende Daten anzutasten. Muss VOR
// dem schema.sql-Lauf passieren, da dessen CREATE INDEX sonst auf die neue Spalte einer
// bereits bestehenden (aelteren) Tabelle stossen wuerde, bevor sie existiert.
function migriere(db) {
  // mitarbeitende muss vor der pendenzen-Migration existieren, da bearbeiter_id darauf verweist.
  db.exec(`
    CREATE TABLE IF NOT EXISTS mitarbeitende (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      name    TEXT NOT NULL,
      aktiv   INTEGER NOT NULL DEFAULT 1 CHECK (aktiv IN (0, 1))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sitzungen (
      token          TEXT PRIMARY KEY,
      mitarbeiter_id INTEGER NOT NULL REFERENCES mitarbeitende(id) ON DELETE CASCADE,
      erstellt_am    TEXT NOT NULL
    )
  `);

  const pendenzenExistiert = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'pendenzen'"
  ).get();
  if (pendenzenExistiert) {
    const spalten = db.prepare('PRAGMA table_info(pendenzen)').all().map((s) => s.name);
    if (!spalten.includes('uebergeordnete_pendenz_id')) {
      db.exec('ALTER TABLE pendenzen ADD COLUMN uebergeordnete_pendenz_id INTEGER REFERENCES pendenzen(id) ON DELETE CASCADE');
    }
    if (!spalten.includes('bearbeiter_id')) {
      db.exec('ALTER TABLE pendenzen ADD COLUMN bearbeiter_id INTEGER REFERENCES mitarbeitende(id) ON DELETE SET NULL');
    }
  }

  const mandantenExistiert = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'mandanten'"
  ).get();
  if (mandantenExistiert) {
    const spalten = db.prepare('PRAGMA table_info(mandanten)').all().map((s) => s.name);
    if (!spalten.includes('email')) {
      db.exec('ALTER TABLE mandanten ADD COLUMN email TEXT');
    }
    // Getrennt vom Ansprechpartner (Spalte "email", Standard beim E-Mail-Versand): eine
    // zweite, nur bei Bedarf genutzte Adresse fuer Geschaeftsfuehrung/Inhaber.
    if (!spalten.includes('geschaeftsfuehrung_email')) {
      db.exec('ALTER TABLE mandanten ADD COLUMN geschaeftsfuehrung_email TEXT');
    }
  }

  const spaltenMitarbeitende = db.prepare('PRAGMA table_info(mitarbeitende)').all().map((s) => s.name);
  if (!spaltenMitarbeitende.includes('email')) {
    db.exec('ALTER TABLE mitarbeitende ADD COLUMN email TEXT');
  }
  if (!spaltenMitarbeitende.includes('passwort_hash')) {
    db.exec('ALTER TABLE mitarbeitende ADD COLUMN passwort_hash TEXT');
  }
}

/** Oeffnet (und initialisiert bei Bedarf) die SQLite-Datenbank unter dem angegebenen Pfad. */
function openDatabase(dbPath) {
  try {
    mkdirSync(dirname(dbPath), { recursive: true });
  } catch {
    // Verzeichnis existiert bereits -- egal.
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  migriere(db);
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schema);
  return db;
}

// Pfad zur Datenbankdatei. Auf einem Cloud-Server ueber die Umgebungsvariable DB_PFAD
// auf ein persistentes Volume zeigen lassen (z.B. /data/pendenzen.sqlite).
const DEFAULT_DB_PATH = process.env.DB_PFAD || join(__dirname, '..', 'data', 'pendenzen.sqlite');

export { openDatabase, DEFAULT_DB_PATH };
