import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  const { aktiv } = req.query;
  let sql = 'SELECT * FROM mandanten';
  const params = [];
  if (aktiv === '1' || aktiv === '0') {
    sql += ' WHERE aktiv = ?';
    params.push(Number(aktiv));
  }
  sql += ' ORDER BY name';
  res.json(db.prepare(sql).all(...params));
});

// Uebersicht mit Pendenzen-Zaehlern pro Mandant, fuer die Mandantenansicht.
router.get('/uebersicht', (req, res) => {
  const db = req.app.locals.db;
  const mandanten = db.prepare('SELECT * FROM mandanten ORDER BY name').all();
  const zaehlerStmt = db.prepare(`
    SELECT status, COUNT(*) AS anzahl FROM pendenzen
    WHERE mandant_id = ? AND status != 'Erledigt'
    GROUP BY status
  `);
  const ergebnis = mandanten.map((mandant) => {
    const zeilen = zaehlerStmt.all(mandant.id);
    const zaehler = Object.fromEntries(zeilen.map((z) => [z.status, z.anzahl]));
    const offenTotal = zeilen.reduce((summe, z) => summe + z.anzahl, 0);
    return { ...mandant, zaehler, offenTotal };
  });
  res.json(ergebnis);
});

router.get('/:id', (req, res) => {
  const db = req.app.locals.db;
  const mandant = db.prepare('SELECT * FROM mandanten WHERE id = ?').get(req.params.id);
  if (!mandant) return res.status(404).json({ fehler: 'Mandant nicht gefunden' });
  res.json(mandant);
});

router.post('/', (req, res) => {
  const db = req.app.locals.db;
  const { name, kuerzel = null, email = null, geschaeftsfuehrungEmail = null, aktiv = 1, notizen = null } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ fehler: 'Name ist erforderlich' });
  }
  const info = db
    .prepare('INSERT INTO mandanten (name, kuerzel, email, geschaeftsfuehrung_email, aktiv, notizen) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name.trim(), kuerzel, email, geschaeftsfuehrungEmail, aktiv ? 1 : 0, notizen);
  const mandant = db.prepare('SELECT * FROM mandanten WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(mandant);
});

router.put('/:id', (req, res) => {
  const db = req.app.locals.db;
  const bestehend = db.prepare('SELECT * FROM mandanten WHERE id = ?').get(req.params.id);
  if (!bestehend) return res.status(404).json({ fehler: 'Mandant nicht gefunden' });

  const name = req.body.name !== undefined ? req.body.name : bestehend.name;
  if (!name || !String(name).trim()) {
    return res.status(400).json({ fehler: 'Name ist erforderlich' });
  }
  const kuerzel = req.body.kuerzel !== undefined ? req.body.kuerzel : bestehend.kuerzel;
  const email = req.body.email !== undefined ? req.body.email : bestehend.email;
  const geschaeftsfuehrungEmail = req.body.geschaeftsfuehrungEmail !== undefined
    ? req.body.geschaeftsfuehrungEmail
    : bestehend.geschaeftsfuehrung_email;
  const aktiv = req.body.aktiv !== undefined ? (req.body.aktiv ? 1 : 0) : bestehend.aktiv;
  const notizen = req.body.notizen !== undefined ? req.body.notizen : bestehend.notizen;

  db.prepare('UPDATE mandanten SET name = ?, kuerzel = ?, email = ?, geschaeftsfuehrung_email = ?, aktiv = ?, notizen = ? WHERE id = ?')
    .run(String(name).trim(), kuerzel, email, geschaeftsfuehrungEmail, aktiv, notizen, req.params.id);
  res.json(db.prepare('SELECT * FROM mandanten WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const db = req.app.locals.db;
  const bestehend = db.prepare('SELECT * FROM mandanten WHERE id = ?').get(req.params.id);
  if (!bestehend) return res.status(404).json({ fehler: 'Mandant nicht gefunden' });
  db.prepare('DELETE FROM mandanten WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

export default router;
