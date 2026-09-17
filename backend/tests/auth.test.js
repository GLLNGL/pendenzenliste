import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  hashePasswort, pruefePasswort, erstelleSitzung,
  findeBenutzerZuSitzung, loescheSitzung, einrichtungNoetig,
} from '../src/auth.js';
import { erstelleApp } from '../src/app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function frischeTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync(join(__dirname, '..', 'src', 'schema.sql'), 'utf-8'));
  return db;
}

describe('Passwort-Hashing', () => {
  test('korrektes Passwort wird akzeptiert, falsches abgelehnt', () => {
    const hash = hashePasswort('geheim123');
    assert.equal(pruefePasswort('geheim123', hash), true);
    assert.equal(pruefePasswort('falsch', hash), false);
  });

  test('gleiche Eingabe ergibt unterschiedliche Hashes (Salt)', () => {
    assert.notEqual(hashePasswort('abc123'), hashePasswort('abc123'));
  });

  test('leerer/kaputter Hash wird sicher abgelehnt', () => {
    assert.equal(pruefePasswort('irgendwas', null), false);
    assert.equal(pruefePasswort('irgendwas', 'kein-doppelpunkt'), false);
  });
});

describe('Sitzungen', () => {
  let db;
  beforeEach(() => {
    db = frischeTestDb();
    db.prepare("INSERT INTO mitarbeitende (id, name, email, passwort_hash, aktiv) VALUES (1, 'Test', 't@x.ch', ?, 1)")
      .run(hashePasswort('pw'));
  });

  test('erstellte Sitzung findet den Benutzer, geloeschte nicht mehr', () => {
    const token = erstelleSitzung(db, 1);
    assert.equal(findeBenutzerZuSitzung(db, token)?.name, 'Test');
    loescheSitzung(db, token);
    assert.equal(findeBenutzerZuSitzung(db, token), null);
  });

  test('inaktiver Mitarbeiter hat keine gueltige Sitzung', () => {
    const token = erstelleSitzung(db, 1);
    db.prepare('UPDATE mitarbeitende SET aktiv = 0 WHERE id = 1').run();
    assert.equal(findeBenutzerZuSitzung(db, token), null);
  });
});

describe('einrichtungNoetig', () => {
  test('true ohne Passwoerter, false sobald einer gesetzt ist', () => {
    const db = frischeTestDb();
    db.prepare("INSERT INTO mitarbeitende (name, email, aktiv) VALUES ('A', 'a@x.ch', 1)").run();
    assert.equal(einrichtungNoetig(db), true);
    db.prepare("UPDATE mitarbeitende SET passwort_hash = ? WHERE email = 'a@x.ch'").run(hashePasswort('pw'));
    assert.equal(einrichtungNoetig(db), false);
  });
});

describe('HTTP: Login-Ablauf', () => {
  let db, server, basis;

  beforeEach(async () => {
    db = frischeTestDb();
    db.prepare("INSERT INTO mitarbeitende (name, email, aktiv) VALUES ('Angelo', 'angelo@estcontrolling.ch', 1)").run();
    const app = erstelleApp(db);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    basis = `http://localhost:${server.address().port}`;
  });

  afterEach(async () => {
    if (!server) return;
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    server = null;
  });

  test('geschuetzte Route ohne Anmeldung -> 401', async () => {
    const res = await fetch(`${basis}/api/mandanten`);
    assert.equal(res.status, 401);
  });

  test('Passwort festlegen, dann anmelden und geschuetzte Route nutzen', async () => {
    const einr = await fetch(`${basis}/api/auth/passwort-festlegen`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'angelo@estcontrolling.ch', passwort: 'test-passwort' }),
    });
    assert.equal(einr.status, 200);
    const cookie = einr.headers.getSetCookie().join('; ');
    assert.ok(cookie.includes('pendenzen_sitzung'));

    const geschuetzt = await fetch(`${basis}/api/mandanten`, { headers: { cookie } });
    assert.equal(geschuetzt.status, 200);
  });

  test('frische Installation: erstes Konto wird mit Name + E-Mail angelegt', async () => {
    db.exec('DELETE FROM mitarbeitende');
    const res = await fetch(`${basis}/api/auth/passwort-festlegen`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Chef', email: 'chef@firma.ch', passwort: 'start-passwort' }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).name, 'Chef');

    // Zweiter Versuch mit fremder Adresse jetzt abgelehnt (Team ist eingerichtet).
    const zweit = await fetch(`${basis}/api/auth/passwort-festlegen`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', email: 'fremd@firma.ch', passwort: 'start-passwort' }),
    });
    assert.equal(zweit.status, 400);
  });

  test('zweites Passwort-Festlegen fuer dieselbe Adresse wird abgelehnt', async () => {
    const body = JSON.stringify({ email: 'angelo@estcontrolling.ch', passwort: 'test-passwort' });
    await fetch(`${basis}/api/auth/passwort-festlegen`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const zweit = await fetch(`${basis}/api/auth/passwort-festlegen`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(zweit.status, 400);
  });

  test('Login mit falschem Passwort -> 401', async () => {
    db.prepare("UPDATE mitarbeitende SET passwort_hash = ? WHERE email = 'angelo@estcontrolling.ch'").run(hashePasswort('richtig'));
    const res = await fetch(`${basis}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'angelo@estcontrolling.ch', passwort: 'falsch' }),
    });
    assert.equal(res.status, 401);
  });

  test('Login und Logout', async () => {
    db.prepare("UPDATE mitarbeitende SET passwort_hash = ? WHERE email = 'angelo@estcontrolling.ch'").run(hashePasswort('richtig'));
    const login = await fetch(`${basis}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'angelo@estcontrolling.ch', passwort: 'richtig' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().join('; ');

    const ich = await fetch(`${basis}/api/auth/ich`, { headers: { cookie } });
    assert.equal((await ich.json()).email, 'angelo@estcontrolling.ch');

    await fetch(`${basis}/api/auth/logout`, { method: 'POST', headers: { cookie } });
    const nachher = await fetch(`${basis}/api/mandanten`, { headers: { cookie } });
    assert.equal(nachher.status, 401);
  });
});
