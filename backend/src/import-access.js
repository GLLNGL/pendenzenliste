// Einmaliger Import der alten Access-Aufgabenliste (Pendenzen.accdb) in die neue
// Pendenzenliste-Datenbank. Liest die von PowerShell exportierte aufgaben-export.json.
//
// Zuordnung (Access -> Pendenzenliste):
//   Priorität "(A) Sofort"      -> Hoch
//   Priorität "(B) Planen"      -> Mittel
//   Status "Abgeschlossen"      -> Erledigt (erledigt_am = Faelligkeitsdatum, da im Alt-System
//                                  kein separates Erledigungsdatum gefuehrt wurde -- Naeherung)
//   Status "Nicht begonnen"/"offen"/"terminieren" -> Offen
//   Zugewiesen an (Kontakt)     -> als Hinweiszeile am Ende der Beschreibung uebernommen
//                                  (die Pendenzenliste kennt aktuell keinen Bearbeiter pro Pendenz)
//   Mandant                     -> nicht gesetzt (Alt-System hatte keine Mandantenzuordnung,
//                                  die Kontakte-Tabelle enthaelt Mitarbeitende, keine Mandanten)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, DEFAULT_DB_PATH } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PRIORITAET_MAP = {
  '(A) Sofort': 'Hoch',
  '(B) Planen': 'Mittel',
};

const STATUS_MAP = {
  'Abgeschlossen': 'Erledigt',
  'Nicht begonnen': 'Offen',
  'offen': 'Offen',
  'terminieren': 'Offen',
};

function htmlZuText(html) {
  if (!html) return null;
  return html
    .replace(/<(div|p|br)[^>]*>/gi, '\n')
    .replace(/<\/(div|p)>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim() || null;
}

function run() {
  const pfad = join(__dirname, '..', 'aufgaben-export.json');
  let roh = readFileSync(pfad, 'utf-8');
  if (roh.charCodeAt(0) === 0xfeff) roh = roh.slice(1); // BOM entfernen (PowerShell schreibt mit BOM)
  const aufgaben = JSON.parse(roh);

  const db = openDatabase(DEFAULT_DB_PATH);
  const insert = db.prepare(`
    INSERT INTO pendenzen
      (titel, mandant_id, beschreibung, faelligkeit, prioritaet, status,
       aufwand_stunden, erstellt_am, erledigt_am, warte_seit, wiedervorlage, regel_id, perioden_schluessel)
    VALUES (?, NULL, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, NULL)
  `);

  let importiert = 0;
  let uebersprungen = 0;

  for (const a of aufgaben) {
    const prioritaet = PRIORITAET_MAP[a.prioritaet] || 'Mittel';
    const status = STATUS_MAP[a.status] || 'Offen';
    const erledigtAm = status === 'Erledigt' ? a.faelligkeitsdatum : null;
    const erstelltAm = a.startdatum || new Date().toISOString();

    let beschreibung = htmlZuText(a.beschreibung);
    if (a.zugewiesenAn) {
      const hinweis = `[Aus Alt-System uebernommen -- urspruenglich zugewiesen an: ${a.zugewiesenAn}]`;
      beschreibung = beschreibung ? `${beschreibung}\n\n${hinweis}` : hinweis;
    }

    if (!a.titel || !a.faelligkeitsdatum) {
      uebersprungen += 1;
      continue;
    }

    insert.run(a.titel.trim(), beschreibung, a.faelligkeitsdatum, prioritaet, status, erstelltAm, erledigtAm);
    importiert += 1;
  }

  console.log(`Import abgeschlossen: ${importiert} Pendenzen importiert, ${uebersprungen} uebersprungen.`);
  db.close();
}

run();
