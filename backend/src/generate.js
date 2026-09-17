import {
  getPeriodKey,
  previousPeriodKey,
  nextPeriodKey,
  berechneFaelligkeiten,
  rendereTitel,
  toISODate,
  fromISODate,
  heutigesDatumUTC,
  addDays,
} from './recurrence.js';

// Nachtragsfenster in Tagen: wie weit in der Vergangenheit liegende, noch nicht erzeugte
// Pendenzen beim Lauf noch nachgetragen werden. Verhindert, dass ein spaeter Erstlauf
// (oder eine lange App-Pause) jahrelange Alt-Perioden auf einmal nachtraegt -- besonders
// wichtig bei jaehrlichen Regeln, wo eine Periode ~365 Tage umfasst.
const NACHTRAGSFENSTER_TAGE = 45;
// Sicherheitsnetz gegen Endlosschleifen bei unerwarteten Datenkonstellationen.
const MAX_ITERATIONEN = 60;

function tageDifferenz(isoA, isoB) {
  return Math.round((fromISODate(isoA).getTime() - fromISODate(isoB).getTime()) / 86_400_000);
}

/**
 * Sammelt alle Faelligkeiten einer Regel, deren Erscheinungsdatum (Faelligkeit - Vorlauf)
 * innerhalb des Nachtragsfensters bis heute liegt, plus alle bereits erscheinenden
 * zukuenftigen Faelligkeiten (kommt in der Praxis kaum vor, ausser bei sehr grossem Vorlauf).
 */
function sammleFaelligeFuerRegel(rule, heute, heuteISO) {
  const treffer = [];
  const aktuellerKey = getPeriodKey(rule.rhythmus, heute);

  let ruecklaufKey = aktuellerKey;
  for (let i = 0; i < MAX_ITERATIONEN; i += 1) {
    const faelligkeiten = berechneFaelligkeiten(rule, ruecklaufKey);
    const erscheintAbISO = toISODate(addDays(faelligkeiten[0].faelligkeit, -rule.vorlauf_tage));
    if (i > 0 && tageDifferenz(heuteISO, erscheintAbISO) > NACHTRAGSFENSTER_TAGE) break;
    treffer.push(...faelligkeiten);
    ruecklaufKey = previousPeriodKey(rule.rhythmus, ruecklaufKey);
  }

  let vorlaufKey = nextPeriodKey(rule.rhythmus, aktuellerKey);
  for (let i = 0; i < MAX_ITERATIONEN; i += 1) {
    const faelligkeiten = berechneFaelligkeiten(rule, vorlaufKey);
    const erscheintAbISO = toISODate(addDays(faelligkeiten[0].faelligkeit, -rule.vorlauf_tage));
    if (erscheintAbISO > heuteISO) break;
    treffer.push(...faelligkeiten);
    vorlaufKey = nextPeriodKey(rule.rhythmus, vorlaufKey);
  }

  return treffer;
}

/**
 * Erzeugt alle faelligen Pendenzen aus aktiven Wiederkehr-Regeln. Idempotent: bereits
 * vorhandene Kombinationen aus regel_id + perioden_schluessel werden uebersprungen
 * (zusaetzlich durch den UNIQUE-Index in der Datenbank abgesichert).
 * Gibt die Anzahl neu erzeugter Pendenzen zurueck.
 */
function generiereFaelligePendenzen(db, heute = heutigesDatumUTC()) {
  const regeln = db.prepare('SELECT * FROM wiederkehr_regeln WHERE aktiv = 1').all();

  const existiertStmt = db.prepare(
    'SELECT 1 FROM pendenzen WHERE regel_id = ? AND perioden_schluessel = ?'
  );
  const insertStmt = db.prepare(`
    INSERT INTO pendenzen (
      titel, mandant_id, beschreibung, faelligkeit, prioritaet, status,
      erstellt_am, regel_id, perioden_schluessel
    ) VALUES (?, ?, NULL, ?, 'Mittel', 'Offen', ?, ?, ?)
  `);

  const heuteUTC = new Date(Date.UTC(heute.getUTCFullYear(), heute.getUTCMonth(), heute.getUTCDate()));
  const heuteISO = toISODate(heuteUTC);
  let erzeugt = 0;

  for (const rule of regeln) {
    const config = JSON.parse(rule.faelligkeit_config);
    const ruleMitConfig = { ...rule, faelligkeit_config: config };

    for (const { periodKey: pk, faelligkeit } of sammleFaelligeFuerRegel(ruleMitConfig, heuteUTC, heuteISO)) {
      const erscheintAbISO = toISODate(addDays(faelligkeit, -rule.vorlauf_tage));
      if (erscheintAbISO > heuteISO) continue;
      if (existiertStmt.get(rule.id, pk)) continue;

      const titel = rendereTitel(rule.titel_vorlage, rule.rhythmus, pk);
      insertStmt.run(
        titel,
        rule.mandant_id,
        toISODate(faelligkeit),
        new Date().toISOString(),
        rule.id,
        pk
      );
      erzeugt += 1;
    }
  }

  return erzeugt;
}

export { generiereFaelligePendenzen };
