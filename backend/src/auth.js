// Passwort-Hashing (scrypt, in Node eingebaut) und Sitzungsverwaltung fuer den Login.
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'pendenzen_sitzung';

function hashePasswort(passwort) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(passwort, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function pruefePasswort(passwort, gespeichert) {
  if (!gespeichert || !gespeichert.includes(':')) return false;
  const [salt, hash] = gespeichert.split(':');
  const original = Buffer.from(hash, 'hex');
  const kandidat = scryptSync(passwort, salt, 64);
  return kandidat.length === original.length && timingSafeEqual(kandidat, original);
}

function erstelleSitzung(db, mitarbeiterId) {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sitzungen (token, mitarbeiter_id, erstellt_am) VALUES (?, ?, ?)')
    .run(token, mitarbeiterId, new Date().toISOString());
  return token;
}

function findeBenutzerZuSitzung(db, token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT m.id, m.name, m.email
    FROM sitzungen s JOIN mitarbeitende m ON m.id = s.mitarbeiter_id
    WHERE s.token = ? AND m.aktiv = 1
  `).get(token);
  return row || null;
}

function loescheSitzung(db, token) {
  if (token) db.prepare('DELETE FROM sitzungen WHERE token = ?').run(token);
}

/** true, wenn noch kein aktiver Mitarbeiter mit E-Mail ein Passwort gesetzt hat. */
function einrichtungNoetig(db) {
  const anzahl = db.prepare(
    "SELECT COUNT(*) AS n FROM mitarbeitende WHERE aktiv = 1 AND email IS NOT NULL AND email != '' AND passwort_hash IS NOT NULL"
  ).get().n;
  return anzahl === 0;
}

/** true, wenn ueberhaupt noch kein Team-Mitglied existiert (frische Installation). */
function keineMitarbeitende(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM mitarbeitende').get().n === 0;
}

/** Express-Middleware: blockt /api/* (ausser /api/auth/*) ohne gueltige Sitzung. */
function authMiddleware(db) {
  return (req, res, next) => {
    if (!req.path.startsWith('/api/') || req.path.startsWith('/api/auth/')) return next();
    const benutzer = findeBenutzerZuSitzung(db, req.cookies?.[COOKIE_NAME]);
    if (!benutzer) return res.status(401).json({ fehler: 'Nicht angemeldet' });
    req.benutzer = benutzer;
    next();
  };
}

export {
  COOKIE_NAME,
  hashePasswort,
  pruefePasswort,
  erstelleSitzung,
  findeBenutzerZuSitzung,
  loescheSitzung,
  einrichtungNoetig,
  keineMitarbeitende,
  authMiddleware,
};
