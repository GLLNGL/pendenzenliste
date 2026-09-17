import { Router } from 'express';
import { RHYTHMEN, FAELLIGKEIT_TYPEN, naechstePendenzen, heutigesDatumUTC } from '../recurrence.js';

const router = Router();
const GUELTIGE_TYPEN = FAELLIGKEIT_TYPEN.map((t) => t.typ);

function mitConfig(regel) {
  return { ...regel, faelligkeit_config: JSON.parse(regel.faelligkeit_config) };
}

function validiere(body) {
  if (!body.titelVorlage || !String(body.titelVorlage).trim()) return 'Titel-Vorlage ist erforderlich';
  if (!RHYTHMEN.includes(body.rhythmus)) return 'Ungueltiger Rhythmus';
  if (!GUELTIGE_TYPEN.includes(body.faelligkeitTyp)) return 'Ungueltiger Faelligkeitstyp';
  if (typeof body.faelligkeitConfig !== 'object' || body.faelligkeitConfig === null) {
    return 'faelligkeitConfig muss ein Objekt sein';
  }
  if (body.vorlaufTage === undefined || Number.isNaN(Number(body.vorlaufTage))) {
    return 'Vorlaufzeit (Tage) ist erforderlich';
  }
  return null;
}

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  const regeln = db.prepare(`
    SELECT r.*, m.name AS mandant_name, m.kuerzel AS mandant_kuerzel
    FROM wiederkehr_regeln r LEFT JOIN mandanten m ON m.id = r.mandant_id
    ORDER BY r.aktiv DESC, r.titel_vorlage
  `).all();
  res.json(regeln.map(mitConfig));
});

router.get('/:id', (req, res) => {
  const db = req.app.locals.db;
  const regel = db.prepare('SELECT * FROM wiederkehr_regeln WHERE id = ?').get(req.params.id);
  if (!regel) return res.status(404).json({ fehler: 'Regel nicht gefunden' });
  res.json(mitConfig(regel));
});

// Vorschau der naechsten N zu erzeugenden Pendenzen einer Regel.
router.get('/:id/vorschau', (req, res) => {
  const db = req.app.locals.db;
  const regel = db.prepare('SELECT * FROM wiederkehr_regeln WHERE id = ?').get(req.params.id);
  if (!regel) return res.status(404).json({ fehler: 'Regel nicht gefunden' });
  const anzahl = Number(req.query.anzahl) || 3;
  const ergebnis = naechstePendenzen(mitConfig(regel), heutigesDatumUTC(), anzahl);
  res.json(ergebnis);
});

router.post('/', (req, res) => {
  const db = req.app.locals.db;
  const fehler = validiere(req.body);
  if (fehler) return res.status(400).json({ fehler });

  const { titelVorlage, mandantId = null, rhythmus, faelligkeitTyp, faelligkeitConfig, vorlaufTage, aktiv = 1 } = req.body;
  const info = db.prepare(`
    INSERT INTO wiederkehr_regeln
      (titel_vorlage, mandant_id, rhythmus, faelligkeit_typ, faelligkeit_config, vorlauf_tage, aktiv)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(titelVorlage).trim(), mandantId, rhythmus, faelligkeitTyp,
    JSON.stringify(faelligkeitConfig), Number(vorlaufTage), aktiv ? 1 : 0
  );
  res.status(201).json(mitConfig(db.prepare('SELECT * FROM wiederkehr_regeln WHERE id = ?').get(info.lastInsertRowid)));
});

router.put('/:id', (req, res) => {
  const db = req.app.locals.db;
  const bestehend = db.prepare('SELECT * FROM wiederkehr_regeln WHERE id = ?').get(req.params.id);
  if (!bestehend) return res.status(404).json({ fehler: 'Regel nicht gefunden' });

  const merged = {
    titelVorlage: req.body.titelVorlage ?? bestehend.titel_vorlage,
    mandantId: req.body.mandantId !== undefined ? req.body.mandantId : bestehend.mandant_id,
    rhythmus: req.body.rhythmus ?? bestehend.rhythmus,
    faelligkeitTyp: req.body.faelligkeitTyp ?? bestehend.faelligkeit_typ,
    faelligkeitConfig: req.body.faelligkeitConfig ?? JSON.parse(bestehend.faelligkeit_config),
    vorlaufTage: req.body.vorlaufTage !== undefined ? req.body.vorlaufTage : bestehend.vorlauf_tage,
    aktiv: req.body.aktiv !== undefined ? req.body.aktiv : bestehend.aktiv,
  };
  const fehler = validiere(merged);
  if (fehler) return res.status(400).json({ fehler });

  db.prepare(`
    UPDATE wiederkehr_regeln SET
      titel_vorlage = ?, mandant_id = ?, rhythmus = ?, faelligkeit_typ = ?,
      faelligkeit_config = ?, vorlauf_tage = ?, aktiv = ?
    WHERE id = ?
  `).run(
    String(merged.titelVorlage).trim(), merged.mandantId, merged.rhythmus, merged.faelligkeitTyp,
    JSON.stringify(merged.faelligkeitConfig), Number(merged.vorlaufTage), merged.aktiv ? 1 : 0,
    req.params.id
  );
  res.json(mitConfig(db.prepare('SELECT * FROM wiederkehr_regeln WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', (req, res) => {
  const db = req.app.locals.db;
  const bestehend = db.prepare('SELECT * FROM wiederkehr_regeln WHERE id = ?').get(req.params.id);
  if (!bestehend) return res.status(404).json({ fehler: 'Regel nicht gefunden' });
  db.prepare('DELETE FROM wiederkehr_regeln WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

export default router;
