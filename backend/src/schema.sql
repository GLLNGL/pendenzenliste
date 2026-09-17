-- Pendenzenliste Datenbankschema
-- Datumsfelder werden als ISO-Text (JJJJ-MM-TT) gespeichert, Zeitstempel als ISO-8601.

CREATE TABLE IF NOT EXISTS mandanten (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  name                   TEXT NOT NULL,
  kuerzel                TEXT,
  email                  TEXT, -- Ansprechpartner/in, Standard beim E-Mail-Versand
  geschaeftsfuehrung_email TEXT, -- nur bei Bedarf, muss beim Versand manuell gewaehlt werden
  aktiv                  INTEGER NOT NULL DEFAULT 1 CHECK (aktiv IN (0, 1)),
  notizen                TEXT
);

CREATE TABLE IF NOT EXISTS mitarbeitende (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT,
  passwort_hash TEXT,
  aktiv         INTEGER NOT NULL DEFAULT 1 CHECK (aktiv IN (0, 1))
);

-- Angemeldete Sitzungen (Login). Token liegt als httpOnly-Cookie im Browser.
CREATE TABLE IF NOT EXISTS sitzungen (
  token          TEXT PRIMARY KEY,
  mitarbeiter_id INTEGER NOT NULL REFERENCES mitarbeitende(id) ON DELETE CASCADE,
  erstellt_am    TEXT NOT NULL
);

-- Applikationsweite Einstellungen als Schluessel-Wert-Paare (z.B. SMTP-Zugangsdaten).
CREATE TABLE IF NOT EXISTS app_einstellungen (
  schluessel TEXT PRIMARY KEY,
  wert       TEXT
);

CREATE TABLE IF NOT EXISTS wiederkehr_regeln (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  titel_vorlage      TEXT NOT NULL,
  mandant_id         INTEGER REFERENCES mandanten(id) ON DELETE SET NULL,
  rhythmus           TEXT NOT NULL CHECK (rhythmus IN ('monatlich', 'quartalsweise', 'halbjaehrlich', 'jaehrlich')),
  faelligkeit_typ    TEXT NOT NULL,
  faelligkeit_config TEXT NOT NULL DEFAULT '{}',
  vorlauf_tage       INTEGER NOT NULL DEFAULT 0,
  aktiv              INTEGER NOT NULL DEFAULT 1 CHECK (aktiv IN (0, 1))
);

CREATE TABLE IF NOT EXISTS pendenzen (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  titel               TEXT NOT NULL,
  mandant_id          INTEGER REFERENCES mandanten(id) ON DELETE SET NULL,
  beschreibung        TEXT,
  faelligkeit         TEXT NOT NULL,
  prioritaet          TEXT NOT NULL DEFAULT 'Mittel' CHECK (prioritaet IN ('Hoch', 'Mittel', 'Tief')),
  status              TEXT NOT NULL DEFAULT 'Offen' CHECK (status IN ('Offen', 'In Arbeit', 'Warte auf Kunde', 'Warte intern', 'Erledigt')),
  aufwand_stunden     REAL,
  erstellt_am         TEXT NOT NULL,
  erledigt_am         TEXT,
  warte_seit          TEXT,
  wiedervorlage       TEXT,
  regel_id            INTEGER REFERENCES wiederkehr_regeln(id) ON DELETE SET NULL,
  perioden_schluessel TEXT,
  uebergeordnete_pendenz_id INTEGER REFERENCES pendenzen(id) ON DELETE CASCADE,
  bearbeiter_id       INTEGER REFERENCES mitarbeitende(id) ON DELETE SET NULL
);

-- Idempotenz: pro Regel und Periode darf nur eine Pendenz existieren.
-- NULL-Werte (manuell erfasste Pendenzen ohne Regel) sind von SQLite als paarweise
-- unterschiedlich behandelt und daher von der Eindeutigkeit ausgenommen.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pendenzen_regel_periode
  ON pendenzen (regel_id, perioden_schluessel);

CREATE INDEX IF NOT EXISTS idx_pendenzen_status ON pendenzen (status);
CREATE INDEX IF NOT EXISTS idx_pendenzen_faelligkeit ON pendenzen (faelligkeit);
CREATE INDEX IF NOT EXISTS idx_pendenzen_mandant ON pendenzen (mandant_id);
CREATE INDEX IF NOT EXISTS idx_pendenzen_uebergeordnet ON pendenzen (uebergeordnete_pendenz_id);

-- Protokoll der ueber "E-Mail senden" verschickten Nachrichten -- damit in der Pendenz sichtbar
-- ist, ob/wann/an wen bereits gemailt wurde (z.B. beim Nachfassen).
CREATE TABLE IF NOT EXISTS pendenz_emails (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pendenz_id  INTEGER NOT NULL REFERENCES pendenzen(id) ON DELETE CASCADE,
  an          TEXT NOT NULL,
  betreff     TEXT,
  gesendet_am TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pendenz_emails_pendenz ON pendenz_emails (pendenz_id);

-- Freitext-Fortschrittsnotizen ("was wurde bereits erledigt") -- getrennt von der festen
-- Beschreibung, damit der Verlauf ueber die Zeit dokumentiert werden kann.
CREATE TABLE IF NOT EXISTS pendenz_notizen (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  pendenz_id     INTEGER NOT NULL REFERENCES pendenzen(id) ON DELETE CASCADE,
  text           TEXT NOT NULL,
  mitarbeiter_id INTEGER REFERENCES mitarbeitende(id) ON DELETE SET NULL,
  erstellt_am    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pendenz_notizen_pendenz ON pendenz_notizen (pendenz_id);
