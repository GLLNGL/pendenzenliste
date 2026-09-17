import { Router } from 'express';
import { hashePasswort } from '../auth.js';

const router = Router();

// Passwort-Hash nie ans Frontend geben -- nur ob ein Login eingerichtet ist.
function ohneHash(m) {
  if (!m) return m;
  const { passwort_hash, ...rest } = m;
  return { ...rest, login_aktiv: !!passwort_hash };
}

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  const { aktiv } = req.query;
  let sql = 'SELECT * FROM mitarbeitende';
  const params = [];
  if (aktiv === '1' || aktiv === '0') {
    sql += ' WHERE aktiv = ?';
    params.push(Number(aktiv));
  }
  sql += ' ORDER BY name';
  res.json(db.prepare(sql).all(...params).map(ohneHash));
});

router.post('/', (req, res) => {
  const db = req.app.locals.db;
  const { name, email = null, aktiv = 1 } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ fehler: 'Name ist erforderlich' });
  const info = db.prepare('INSERT INTO mitarbeitende (name, email, aktiv) VALUES (?, ?, ?)')
    .run(name.trim(), email, aktiv ? 1 : 0);
  res.status(201).json(ohneHash(db.prepare('SELECT * FROM mitarbeitende WHERE id = ?').get(info.lastInsertRowid)));
});

router.put('/:id', (req, res) => {
  const db = req.app.locals.db;
  const bestehend = db.prepare('SELECT * FROM mitarbeitende WHERE id = ?').get(req.params.id);
  if (!bestehend) return res.status(404).json({ fehler: 'Mitarbeiter/in nicht gefunden' });

  const name = req.body.name !== undefined ? req.body.name : bestehend.name;
  if (!name || !String(name).trim()) return res.status(400).json({ fehler: 'Name ist erforderlich' });
  const email = req.body.email !== undefined ? req.body.email : bestehend.email;
  const aktiv = req.body.aktiv !== undefined ? (req.body.aktiv ? 1 : 0) : bestehend.aktiv;

  db.prepare('UPDATE mitarbeitende SET name = ?, email = ?, aktiv = ? WHERE id = ?')
    .run(String(name).trim(), email, aktiv, req.params.id);

  // Optional: Passwort setzen/zuruecksetzen (durch angemeldete Benutzer).
  if (req.body.passwort !== undefined && req.body.passwort !== '') {
    if (String(req.body.passwort).length < 6) {
      return res.status(400).json({ fehler: 'Das Passwort muss mindestens 6 Zeichen haben.' });
    }
    db.prepare('UPDATE mitarbeitende SET passwort_hash = ? WHERE id = ?')
      .run(hashePasswort(String(req.body.passwort)), req.params.id);
    // Bestehende Sitzungen dieser Person beenden, damit ein zurueckgesetztes Passwort greift.
    db.prepare('DELETE FROM sitzungen WHERE mitarbeiter_id = ?').run(req.params.id);
  }
  // Login komplett entfernen
  if (req.body.loginEntfernen === true) {
    db.prepare('UPDATE mitarbeitende SET passwort_hash = NULL WHERE id = ?').run(req.params.id);
    db.prepare('DELETE FROM sitzungen WHERE mitarbeiter_id = ?').run(req.params.id);
  }

  res.json(ohneHash(db.prepare('SELECT * FROM mitarbeitende WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', (req, res) => {
  const db = req.app.locals.db;
  const bestehend = db.prepare('SELECT * FROM mitarbeitende WHERE id = ?').get(req.params.id);
  if (!bestehend) return res.status(404).json({ fehler: 'Mitarbeiter/in nicht gefunden' });
  db.prepare('DELETE FROM mitarbeitende WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

export default router;
