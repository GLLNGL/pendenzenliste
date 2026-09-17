import { Router } from 'express';
import {
  COOKIE_NAME, hashePasswort, pruefePasswort, erstelleSitzung,
  findeBenutzerZuSitzung, loescheSitzung, einrichtungNoetig, keineMitarbeitende,
} from '../auth.js';

const router = Router();

// Cookie ~180 Tage gueltig, damit man sich nicht staendig neu anmelden muss.
// secure=true (nur ueber HTTPS) sobald NODE_ENV=production (Cloud-Betrieb).
const COOKIE_OPTIONEN = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 180 * 24 * 60 * 60 * 1000,
};

router.get('/status', (req, res) => {
  const db = req.app.locals.db;
  res.json({
    einrichtungNoetig: einrichtungNoetig(db),
    ersterBenutzer: keineMitarbeitende(db),
  });
});

router.get('/ich', (req, res) => {
  const db = req.app.locals.db;
  const benutzer = findeBenutzerZuSitzung(db, req.cookies?.[COOKIE_NAME]);
  if (!benutzer) return res.status(401).json({ fehler: 'Nicht angemeldet' });
  res.json(benutzer);
});

function mitarbeiterZuEmail(db, email) {
  if (!email) return null;
  return db.prepare(
    "SELECT * FROM mitarbeitende WHERE aktiv = 1 AND lower(email) = lower(?)"
  ).get(String(email).trim()) || null;
}

router.post('/login', (req, res) => {
  const db = req.app.locals.db;
  const { email, passwort } = req.body;
  const mitarbeiter = mitarbeiterZuEmail(db, email);

  if (!mitarbeiter || !mitarbeiter.passwort_hash || !pruefePasswort(passwort || '', mitarbeiter.passwort_hash)) {
    return res.status(401).json({ fehler: 'E-Mail-Adresse oder Passwort falsch.' });
  }

  const token = erstelleSitzung(db, mitarbeiter.id);
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONEN);
  res.json({ id: mitarbeiter.id, name: mitarbeiter.name, email: mitarbeiter.email });
});

router.post('/logout', (req, res) => {
  const db = req.app.locals.db;
  loescheSitzung(db, req.cookies?.[COOKIE_NAME]);
  res.clearCookie(COOKIE_NAME);
  res.json({ abgemeldet: true });
});

// Erstmaliges Passwort setzen. Zwei Faelle:
//  - Es existiert bereits ein Team-Mitglied mit dieser E-Mail (ohne Passwort) -> Passwort setzen.
//  - Die Datenbank ist ganz leer (frische Installation) -> erstes Team-Mitglied anlegen (Name noetig).
router.post('/passwort-festlegen', (req, res) => {
  const db = req.app.locals.db;
  const { email, passwort, name } = req.body;
  if (!passwort || String(passwort).length < 6) {
    return res.status(400).json({ fehler: 'Das Passwort muss mindestens 6 Zeichen haben.' });
  }
  if (!email || !String(email).trim()) {
    return res.status(400).json({ fehler: 'E-Mail-Adresse ist erforderlich.' });
  }

  let mitarbeiter = mitarbeiterZuEmail(db, email);

  if (!mitarbeiter) {
    if (!keineMitarbeitende(db)) {
      return res.status(400).json({ fehler: 'Für diese E-Mail-Adresse ist kein aktives Team-Mitglied hinterlegt. Bitte zuerst unter "Team" erfassen.' });
    }
    if (!name || !String(name).trim()) {
      return res.status(400).json({ fehler: 'Name ist erforderlich.' });
    }
    const info = db.prepare('INSERT INTO mitarbeitende (name, email, passwort_hash, aktiv) VALUES (?, ?, ?, 1)')
      .run(String(name).trim(), String(email).trim(), hashePasswort(passwort));
    mitarbeiter = db.prepare('SELECT * FROM mitarbeitende WHERE id = ?').get(info.lastInsertRowid);
  } else {
    if (mitarbeiter.passwort_hash) {
      return res.status(400).json({ fehler: 'Für diese Adresse ist bereits ein Passwort gesetzt. Bitte anmelden.' });
    }
    db.prepare('UPDATE mitarbeitende SET passwort_hash = ? WHERE id = ?').run(hashePasswort(passwort), mitarbeiter.id);
  }

  const token = erstelleSitzung(db, mitarbeiter.id);
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONEN);
  res.json({ id: mitarbeiter.id, name: mitarbeiter.name, email: mitarbeiter.email });
});

export default router;
