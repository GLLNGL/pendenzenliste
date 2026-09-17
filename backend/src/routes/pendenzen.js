import { Router } from 'express';
import { STATUS_WERTE, PRIORITAETEN } from '../constants.js';
import { toISODate, addDays, heutigesDatumUTC } from '../recurrence.js';
import { baueICS, dateinameFuer } from '../ics.js';

const router = Router();

function heuteISO() {
  return toISODate(heutigesDatumUTC());
}

// Haupt- und Teilaufgabe bleiben im Status verknuepft:
//  - Bottom-up: aendert sich der Status einer Teilaufgabe, wird der Status der Hauptaufgabe
//    daraus abgeleitet -- alle Teilaufgaben offen -> Offen, alle erledigt -> Erledigt, sonst
//    (mind. eine nicht mehr offen, aber nicht alle erledigt) -> In Arbeit.
//  - Top-down: wird der Status einer Hauptaufgabe manuell gesetzt, kaskadiert das auf alle
//    Teilaufgaben -- Erledigt setzt alle auf erledigt, jeder andere Status alle zurueck auf offen.
// Beide Richtungen sind eigenstaendige, einmalige Aktualisierungen (kein Aufruf ruft die jeweils
// andere Richtung erneut auf), darum keine Gefahr einer Endlosschleife.
function leiteHauptaufgabenStatusAb(db, hauptaufgabeId) {
  const teilaufgaben = db.prepare('SELECT status FROM pendenzen WHERE uebergeordnete_pendenz_id = ?').all(hauptaufgabeId);
  if (teilaufgaben.length === 0) return;

  const alleOffen = teilaufgaben.every((t) => t.status === 'Offen');
  const alleErledigt = teilaufgaben.every((t) => t.status === 'Erledigt');
  const neuerStatus = alleErledigt ? 'Erledigt' : alleOffen ? 'Offen' : 'In Arbeit';

  const hauptaufgabe = db.prepare('SELECT status FROM pendenzen WHERE id = ?').get(hauptaufgabeId);
  if (!hauptaufgabe || hauptaufgabe.status === neuerStatus) return;

  const erledigtAm = neuerStatus === 'Erledigt' ? heuteISO() : null;
  db.prepare('UPDATE pendenzen SET status = ?, erledigt_am = ? WHERE id = ?').run(neuerStatus, erledigtAm, hauptaufgabeId);
}

function kaskadiereAnTeilaufgaben(db, hauptaufgabeId, neuerStatus) {
  const zielStatus = neuerStatus === 'Erledigt' ? 'Erledigt' : 'Offen';
  const erledigtAm = zielStatus === 'Erledigt' ? heuteISO() : null;
  db.prepare('UPDATE pendenzen SET status = ?, erledigt_am = ? WHERE uebergeordnete_pendenz_id = ?')
    .run(zielStatus, erledigtAm, hauptaufgabeId);
}

// Nach jeder Statusaenderung einer Pendenz aufrufen: je nachdem ob sie eine Teilaufgabe oder
// eine Hauptaufgabe ist, wird die jeweils verknuepfte Seite synchronisiert.
function synchronisiereVerknuepfteAufgaben(db, pendenzVorDerAenderung, neuerStatus) {
  if (pendenzVorDerAenderung.uebergeordnete_pendenz_id) {
    leiteHauptaufgabenStatusAb(db, pendenzVorDerAenderung.uebergeordnete_pendenz_id);
  } else {
    kaskadiereAnTeilaufgaben(db, pendenzVorDerAenderung.id, neuerStatus);
  }
}

// Teilaufgaben-Fortschritt (fuer die Anzeige an der Hauptaufgabe) und Titel der Hauptaufgabe
// (fuer die Anzeige an einer Teilaufgabe) werden ueberall mitgeliefert, wo Pendenzen gelistet
// werden -- so brauchen Cockpit, Alle-Pendenzen und Mandantenansicht keine Zusatzabfragen.
const TEILAUFGABEN_SPALTEN = `,
      (SELECT COUNT(*) FROM pendenzen c WHERE c.uebergeordnete_pendenz_id = p.id) AS teilaufgaben_gesamt,
      (SELECT COUNT(*) FROM pendenzen c WHERE c.uebergeordnete_pendenz_id = p.id AND c.status = 'Erledigt') AS teilaufgaben_erledigt,
      eltern.titel AS eltern_titel`;
const TEILAUFGABEN_JOIN = 'LEFT JOIN pendenzen eltern ON eltern.id = p.uebergeordnete_pendenz_id';

// Kurzinfo "wurde/wann zuletzt gemailt", fuer eine kleine Markierung in der Liste -- der
// vollstaendige Verlauf (alle Versand-Eintraege) kommt ueber die eigene /:id/emails-Route.
const EMAIL_SPALTEN = `,
      (SELECT COUNT(*) FROM pendenz_emails e WHERE e.pendenz_id = p.id) AS email_anzahl,
      (SELECT MAX(gesendet_am) FROM pendenz_emails e WHERE e.pendenz_id = p.id) AS email_zuletzt_gesendet_am`;

const SORTIERUNGEN = {
  faelligkeit_asc: 'p.faelligkeit ASC, prioritaet_rang ASC',
  faelligkeit_desc: 'p.faelligkeit DESC, prioritaet_rang ASC',
  prioritaet: 'prioritaet_rang ASC, p.faelligkeit ASC',
  erstellt_am_desc: 'p.erstellt_am DESC',
  erledigt_am_desc: 'p.erledigt_am DESC',
};

// Baut WHERE-Klausel + Parameter aus den Query-Filtern. Wird von der Listen- und der
// Archiv-Route gemeinsam genutzt.
function baueFilter(query) {
  const bedingungen = [];
  const params = [];

  if (query.status) {
    const werte = String(query.status).split(',').filter((s) => STATUS_WERTE.includes(s));
    if (werte.length) {
      bedingungen.push(`p.status IN (${werte.map(() => '?').join(',')})`);
      params.push(...werte);
    }
  }
  if (query.prioritaet) {
    const werte = String(query.prioritaet).split(',').filter((p) => PRIORITAETEN.includes(p));
    if (werte.length) {
      bedingungen.push(`p.prioritaet IN (${werte.map(() => '?').join(',')})`);
      params.push(...werte);
    }
  }
  if (query.mandantId === 'keiner') {
    bedingungen.push('p.mandant_id IS NULL');
  } else if (query.mandantId) {
    bedingungen.push('p.mandant_id = ?');
    params.push(Number(query.mandantId));
  }
  if (query.von) {
    bedingungen.push('p.faelligkeit >= ?');
    params.push(query.von);
  }
  if (query.bis) {
    bedingungen.push('p.faelligkeit <= ?');
    params.push(query.bis);
  }
  if (query.erledigtVon) {
    bedingungen.push('p.erledigt_am >= ?');
    params.push(query.erledigtVon);
  }
  if (query.erledigtBis) {
    bedingungen.push('p.erledigt_am <= ?');
    params.push(query.erledigtBis);
  }
  if (query.q) {
    bedingungen.push('(p.titel LIKE ? OR p.beschreibung LIKE ?)');
    const suchbegriff = `%${query.q}%`;
    params.push(suchbegriff, suchbegriff);
  }
  if (query.uebergeordneteId) {
    bedingungen.push('p.uebergeordnete_pendenz_id = ?');
    params.push(Number(query.uebergeordneteId));
  }
  if (query.nurHauptaufgaben === '1') {
    bedingungen.push('p.uebergeordnete_pendenz_id IS NULL');
  }

  return { whereSql: bedingungen.length ? `WHERE ${bedingungen.join(' AND ')}` : '', params };
}

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  const { whereSql, params } = baueFilter(req.query);
  const sortSql = SORTIERUNGEN[req.query.sort] || SORTIERUNGEN.faelligkeit_asc;
  const sql = `
    SELECT p.*, m.name AS mandant_name, m.kuerzel AS mandant_kuerzel, m.email AS mandant_email, m.geschaeftsfuehrung_email AS mandant_geschaeftsfuehrung_email,
      b.name AS bearbeiter_name, b.email AS bearbeiter_email,
      CASE p.prioritaet WHEN 'Hoch' THEN 0 WHEN 'Mittel' THEN 1 ELSE 2 END AS prioritaet_rang
      ${TEILAUFGABEN_SPALTEN}${EMAIL_SPALTEN}
    FROM pendenzen p
    LEFT JOIN mandanten m ON m.id = p.mandant_id
    LEFT JOIN mitarbeitende b ON b.id = p.bearbeiter_id
    ${TEILAUFGABEN_JOIN}
    ${whereSql}
    ORDER BY ${sortSql}
  `;
  res.json(db.prepare(sql).all(...params));
});

// Cockpit: ueberfaellig, heute faellig, morgen faellig, Nachfassen (Warte auf Kunde, faellige
// Wiedervorlage). Alles weiter in der Zukunft zeigt das Frontend als Kalender, dafuer reicht die
// normale Listen-Route mit von/bis-Filter -- eine eigene Kalender-Route ist nicht noetig.
router.get('/cockpit', (req, res) => {
  const db = req.app.locals.db;
  const heute = heuteISO();
  const morgen = toISODate(addDays(heutigesDatumUTC(), 1));

  const basisSelect = `
    SELECT p.*, m.name AS mandant_name, m.kuerzel AS mandant_kuerzel, m.email AS mandant_email, m.geschaeftsfuehrung_email AS mandant_geschaeftsfuehrung_email,
      b.name AS bearbeiter_name, b.email AS bearbeiter_email ${TEILAUFGABEN_SPALTEN}${EMAIL_SPALTEN}
    FROM pendenzen p LEFT JOIN mandanten m ON m.id = p.mandant_id
    LEFT JOIN mitarbeitende b ON b.id = p.bearbeiter_id
    ${TEILAUFGABEN_JOIN}
  `;

  const ueberfaellig = db.prepare(`
    ${basisSelect} WHERE p.status != 'Erledigt' AND p.faelligkeit < ?
    ORDER BY p.faelligkeit ASC
  `).all(heute);

  const heuteFaellig = db.prepare(`
    ${basisSelect} WHERE p.status != 'Erledigt' AND p.faelligkeit = ?
    ORDER BY p.prioritaet
  `).all(heute);

  const morgenFaellig = db.prepare(`
    ${basisSelect} WHERE p.status != 'Erledigt' AND p.faelligkeit = ?
    ORDER BY p.prioritaet
  `).all(morgen);

  const nachfassen = db.prepare(`
    ${basisSelect} WHERE p.status = 'Warte auf Kunde' AND p.wiedervorlage IS NOT NULL AND p.wiedervorlage <= ?
    ORDER BY p.wiedervorlage ASC
  `).all(heute);

  res.json({ ueberfaellig, heuteFaellig, morgenFaellig, nachfassen });
});

router.get('/:id', (req, res) => {
  const db = req.app.locals.db;
  const pendenz = db.prepare(`
    SELECT p.*, m.name AS mandant_name, m.kuerzel AS mandant_kuerzel, m.email AS mandant_email, m.geschaeftsfuehrung_email AS mandant_geschaeftsfuehrung_email,
      b.name AS bearbeiter_name, b.email AS bearbeiter_email ${TEILAUFGABEN_SPALTEN}${EMAIL_SPALTEN}
    FROM pendenzen p LEFT JOIN mandanten m ON m.id = p.mandant_id
    LEFT JOIN mitarbeitende b ON b.id = p.bearbeiter_id
    ${TEILAUFGABEN_JOIN}
    WHERE p.id = ?
  `).get(req.params.id);
  if (!pendenz) return res.status(404).json({ fehler: 'Pendenz nicht gefunden' });
  res.json(pendenz);
});

// Kalenderdatei (.ics) fuer eine einzelne Pendenz/Teilaufgabe -- Download zum direkten
// Importieren in Outlook oder einen anderen Kalender.
router.get('/:id/ics', (req, res) => {
  const db = req.app.locals.db;
  const pendenz = db.prepare('SELECT * FROM pendenzen WHERE id = ?').get(req.params.id);
  if (!pendenz) return res.status(404).json({ fehler: 'Pendenz nicht gefunden' });

  const ics = baueICS({ titel: pendenz.titel, beschreibung: pendenz.beschreibung, faelligkeit: pendenz.faelligkeit, uid: `pendenz-${pendenz.id}@pendenzenliste.local` });
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${dateinameFuer(pendenz.titel)}"`);
  res.send(ics);
});

// Teilaufgaben einer Hauptaufgabe, sortiert nach eigener Faelligkeit.
router.get('/:id/teilaufgaben', (req, res) => {
  const db = req.app.locals.db;
  const rows = db.prepare(`
    SELECT p.*, m.name AS mandant_name, m.kuerzel AS mandant_kuerzel, m.email AS mandant_email, m.geschaeftsfuehrung_email AS mandant_geschaeftsfuehrung_email,
      b.name AS bearbeiter_name
    FROM pendenzen p LEFT JOIN mandanten m ON m.id = p.mandant_id
    LEFT JOIN mitarbeitende b ON b.id = p.bearbeiter_id
    WHERE p.uebergeordnete_pendenz_id = ?
    ORDER BY p.faelligkeit ASC
  `).all(req.params.id);
  res.json(rows);
});

// Verlauf der ueber "E-Mail senden" verschickten Nachrichten zu dieser Pendenz, neueste zuerst.
router.get('/:id/emails', (req, res) => {
  const db = req.app.locals.db;
  const rows = db.prepare(`
    SELECT id, an, betreff, gesendet_am FROM pendenz_emails
    WHERE pendenz_id = ?
    ORDER BY gesendet_am DESC
  `).all(req.params.id);
  res.json(rows);
});

// Fortschrittsnotizen einer Pendenz, neueste zuerst.
router.get('/:id/notizen', (req, res) => {
  const db = req.app.locals.db;
  const rows = db.prepare(`
    SELECT n.id, n.text, n.erstellt_am, m.name AS mitarbeiter_name
    FROM pendenz_notizen n
    LEFT JOIN mitarbeitende m ON m.id = n.mitarbeiter_id
    WHERE n.pendenz_id = ?
    ORDER BY n.erstellt_am DESC
  `).all(req.params.id);
  res.json(rows);
});

router.post('/:id/notizen', (req, res) => {
  const db = req.app.locals.db;
  const { text } = req.body;
  if (!text || !String(text).trim()) return res.status(400).json({ fehler: 'Text ist erforderlich' });
  const pendenz = db.prepare('SELECT id FROM pendenzen WHERE id = ?').get(req.params.id);
  if (!pendenz) return res.status(404).json({ fehler: 'Pendenz nicht gefunden' });

  const info = db.prepare('INSERT INTO pendenz_notizen (pendenz_id, text, mitarbeiter_id, erstellt_am) VALUES (?, ?, ?, ?)')
    .run(req.params.id, String(text).trim(), req.benutzer?.id ?? null, new Date().toISOString());
  const notiz = db.prepare(`
    SELECT n.id, n.text, n.erstellt_am, m.name AS mitarbeiter_name
    FROM pendenz_notizen n LEFT JOIN mitarbeitende m ON m.id = n.mitarbeiter_id
    WHERE n.id = ?
  `).get(info.lastInsertRowid);
  res.status(201).json(notiz);
});

router.delete('/:id/notizen/:notizId', (req, res) => {
  const db = req.app.locals.db;
  const bestehend = db.prepare('SELECT id FROM pendenz_notizen WHERE id = ? AND pendenz_id = ?').get(req.params.notizId, req.params.id);
  if (!bestehend) return res.status(404).json({ fehler: 'Notiz nicht gefunden' });
  db.prepare('DELETE FROM pendenz_notizen WHERE id = ?').run(req.params.notizId);
  res.status(204).end();
});

router.post('/', (req, res) => {
  const db = req.app.locals.db;
  const {
    titel, mandantId = null, beschreibung = null, faelligkeit,
    prioritaet = 'Mittel', status = 'Offen', aufwandStunden = null,
    warteSeit = null, wiedervorlage = null, uebergeordnetePendenzId = null, bearbeiterId = null,
  } = req.body;

  if (!titel || !titel.trim()) return res.status(400).json({ fehler: 'Titel ist erforderlich' });
  if (!faelligkeit) return res.status(400).json({ fehler: 'Faelligkeitsdatum ist erforderlich' });
  if (!PRIORITAETEN.includes(prioritaet)) return res.status(400).json({ fehler: 'Ungueltige Prioritaet' });
  if (!STATUS_WERTE.includes(status)) return res.status(400).json({ fehler: 'Ungueltiger Status' });

  if (uebergeordnetePendenzId) {
    const eltern = db.prepare('SELECT id FROM pendenzen WHERE id = ?').get(uebergeordnetePendenzId);
    if (!eltern) return res.status(400).json({ fehler: 'Hauptaufgabe nicht gefunden' });
  }

  const effektivWarteSeit = status === 'Warte auf Kunde' ? (warteSeit || heuteISO()) : warteSeit;

  const info = db.prepare(`
    INSERT INTO pendenzen
      (titel, mandant_id, beschreibung, faelligkeit, prioritaet, status,
       aufwand_stunden, erstellt_am, warte_seit, wiedervorlage, uebergeordnete_pendenz_id, bearbeiter_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    titel.trim(), mandantId, beschreibung, faelligkeit, prioritaet, status,
    aufwandStunden, new Date().toISOString(), effektivWarteSeit, wiedervorlage, uebergeordnetePendenzId, bearbeiterId
  );

  // Neue Teilaufgabe kann den abgeleiteten Status der Hauptaufgabe veraendern (z.B. wird eine
  // bereits erledigte Hauptaufgabe durch eine neue offene Teilaufgabe wieder "In Arbeit").
  if (uebergeordnetePendenzId) {
    leiteHauptaufgabenStatusAb(db, uebergeordnetePendenzId);
  }

  res.status(201).json(db.prepare('SELECT * FROM pendenzen WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const db = req.app.locals.db;
  const bestehend = db.prepare('SELECT * FROM pendenzen WHERE id = ?').get(req.params.id);
  if (!bestehend) return res.status(404).json({ fehler: 'Pendenz nicht gefunden' });

  const b = req.body;
  const titel = b.titel !== undefined ? b.titel : bestehend.titel;
  const status = b.status !== undefined ? b.status : bestehend.status;
  const prioritaet = b.prioritaet !== undefined ? b.prioritaet : bestehend.prioritaet;
  if (!titel || !String(titel).trim()) return res.status(400).json({ fehler: 'Titel ist erforderlich' });
  if (!PRIORITAETEN.includes(prioritaet)) return res.status(400).json({ fehler: 'Ungueltige Prioritaet' });
  if (!STATUS_WERTE.includes(status)) return res.status(400).json({ fehler: 'Ungueltiger Status' });

  const mandantId = b.mandantId !== undefined ? b.mandantId : bestehend.mandant_id;
  const bearbeiterId = b.bearbeiterId !== undefined ? b.bearbeiterId : bestehend.bearbeiter_id;
  const beschreibung = b.beschreibung !== undefined ? b.beschreibung : bestehend.beschreibung;
  const faelligkeit = b.faelligkeit !== undefined ? b.faelligkeit : bestehend.faelligkeit;
  const aufwandStunden = b.aufwandStunden !== undefined ? b.aufwandStunden : bestehend.aufwand_stunden;
  let warteSeit = b.warteSeit !== undefined ? b.warteSeit : bestehend.warte_seit;
  let wiedervorlage = b.wiedervorlage !== undefined ? b.wiedervorlage : bestehend.wiedervorlage;
  let erledigtAm = bestehend.erledigt_am;

  // Statuswechsel-Automatik: Beim Abhaken Erledigungsdatum setzen; beim Wechsel zu
  // "Warte auf Kunde" ohne Angabe automatisch "warte seit heute" setzen.
  if (status === 'Erledigt' && bestehend.status !== 'Erledigt' && b.erledigtAm === undefined) {
    erledigtAm = heuteISO();
  } else if (status !== 'Erledigt' && b.erledigtAm === undefined) {
    erledigtAm = null;
  } else if (b.erledigtAm !== undefined) {
    erledigtAm = b.erledigtAm;
  }
  if (status === 'Warte auf Kunde' && !warteSeit) {
    warteSeit = heuteISO();
  }

  db.prepare(`
    UPDATE pendenzen SET
      titel = ?, mandant_id = ?, beschreibung = ?, faelligkeit = ?, prioritaet = ?, status = ?,
      aufwand_stunden = ?, erledigt_am = ?, warte_seit = ?, wiedervorlage = ?, bearbeiter_id = ?
    WHERE id = ?
  `).run(
    String(titel).trim(), mandantId, beschreibung, faelligkeit, prioritaet, status,
    aufwandStunden, erledigtAm, warteSeit, wiedervorlage, bearbeiterId, req.params.id
  );
  synchronisiereVerknuepfteAufgaben(db, bestehend, status);

  res.json(db.prepare('SELECT * FROM pendenzen WHERE id = ?').get(req.params.id));
});

// Schnelles Statuswechsel/Abhaken direkt aus der Liste, ohne Detailansicht.
router.patch('/:id/status', (req, res) => {
  const db = req.app.locals.db;
  const bestehend = db.prepare('SELECT * FROM pendenzen WHERE id = ?').get(req.params.id);
  if (!bestehend) return res.status(404).json({ fehler: 'Pendenz nicht gefunden' });

  const { status } = req.body;
  if (!STATUS_WERTE.includes(status)) return res.status(400).json({ fehler: 'Ungueltiger Status' });

  let erledigtAm = bestehend.erledigt_am;
  let warteSeit = bestehend.warte_seit;
  if (status === 'Erledigt') {
    erledigtAm = heuteISO();
  } else {
    erledigtAm = null;
  }
  if (status === 'Warte auf Kunde' && !warteSeit) {
    warteSeit = heuteISO();
  }

  db.prepare('UPDATE pendenzen SET status = ?, erledigt_am = ?, warte_seit = ? WHERE id = ?')
    .run(status, erledigtAm, warteSeit, req.params.id);
  synchronisiereVerknuepfteAufgaben(db, bestehend, status);

  res.json(db.prepare('SELECT * FROM pendenzen WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const db = req.app.locals.db;
  const bestehend = db.prepare('SELECT * FROM pendenzen WHERE id = ?').get(req.params.id);
  if (!bestehend) return res.status(404).json({ fehler: 'Pendenz nicht gefunden' });
  db.prepare('DELETE FROM pendenzen WHERE id = ?').run(req.params.id);
  // War es eine Teilaufgabe, veraendert das Loeschen ggf. den abgeleiteten Status der
  // Hauptaufgabe (z.B. sind jetzt alle verbleibenden Teilaufgaben erledigt).
  if (bestehend.uebergeordnete_pendenz_id) {
    leiteHauptaufgabenStatusAb(db, bestehend.uebergeordnete_pendenz_id);
  }
  res.status(204).end();
});

// Fuer Tests einzeln exportiert (Verknuepfungslogik Haupt-/Teilaufgabe-Status).
export { leiteHauptaufgabenStatusAb, kaskadiereAnTeilaufgaben, synchronisiereVerknuepfteAufgaben };
export default router;
