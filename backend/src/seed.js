// Seed-Skript: fuellt die Datenbank mit Beispiel-Mandanten, Wiederkehr-Regeln und
// Beispiel-Pendenzen. Loescht dabei vorhandene Daten -- nur fuer Demo/Entwicklung gedacht.
import { openDatabase, DEFAULT_DB_PATH } from './db.js';
import { toISODate, addDays } from './recurrence.js';
import { generiereFaelligePendenzen } from './generate.js';

function run() {
  const db = openDatabase(DEFAULT_DB_PATH);

  db.exec('DELETE FROM pendenzen');
  db.exec('DELETE FROM wiederkehr_regeln');
  db.exec('DELETE FROM mandanten');
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('pendenzen', 'wiederkehr_regeln', 'mandanten')");

  const insertMandant = db.prepare(
    'INSERT INTO mandanten (name, kuerzel, aktiv, notizen) VALUES (?, ?, 1, ?)'
  );
  const mandanten = {
    mueller: insertMandant.run('Mueller AG', 'MUE', 'Handel, ca. 12 Mitarbeitende').lastInsertRowid,
    bergland: insertMandant.run('Bergland Bau GmbH', 'BLB', 'Bauunternehmen, saisonal').lastInsertRowid,
    sonnenschein: insertMandant.run('Cafe Sonnenschein', 'CAS', 'Einzelunternehmen').lastInsertRowid,
    weber: insertMandant.run('Weber Immobilien AG', 'WEB', 'Liegenschaftsverwaltung').lastInsertRowid,
  };

  const insertRegel = db.prepare(`
    INSERT INTO wiederkehr_regeln
      (titel_vorlage, mandant_id, rhythmus, faelligkeit_typ, faelligkeit_config, vorlauf_tage, aktiv)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);

  insertRegel.run(
    'MWST-Abrechnung {Quartal} {Jahr}', mandanten.mueller, 'quartalsweise',
    'tage_nach_periodenende', JSON.stringify({ tage: 60 }), 30
  );
  insertRegel.run(
    'Lohnlauf {Monat} {Jahr}', mandanten.mueller, 'monatlich',
    'tag_des_monats', JSON.stringify({ tag: 25 }), 7
  );
  insertRegel.run(
    'MWST-Abrechnung {Quartal} {Jahr}', mandanten.bergland, 'quartalsweise',
    'tage_nach_periodenende', JSON.stringify({ tage: 60 }), 30
  );
  insertRegel.run(
    'Zahlungslauf {Monat} {Jahr}', mandanten.bergland, 'monatlich',
    'tage_des_monats_liste', JSON.stringify({ tage: [15, 28] }), 3
  );
  insertRegel.run(
    'Lohnlauf {Monat} {Jahr}', mandanten.sonnenschein, 'monatlich',
    'tag_des_monats', JSON.stringify({ tag: 25 }), 7
  );
  insertRegel.run(
    'Jahresabschluss {Jahr}', mandanten.sonnenschein, 'jaehrlich',
    'tag_monat_folgejahr', JSON.stringify({ tag: 30, monat: 6, jahre_offset: 1 }), 120
  );
  insertRegel.run(
    'Jahresabschluss {Jahr}', mandanten.weber, 'jaehrlich',
    'tag_monat_folgejahr', JSON.stringify({ tag: 30, monat: 6, jahre_offset: 1 }), 120
  );
  insertRegel.run(
    'MWST-Abrechnung {Quartal} {Jahr}', mandanten.weber, 'quartalsweise',
    'tage_nach_periodenende', JSON.stringify({ tage: 60 }), 30
  );

  const heute = new Date();
  const insertPendenz = db.prepare(`
    INSERT INTO pendenzen
      (titel, mandant_id, beschreibung, faelligkeit, prioritaet, status,
       aufwand_stunden, erstellt_am, erledigt_am, warte_seit, wiedervorlage, regel_id, perioden_schluessel)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
  `);
  const jetzt = new Date().toISOString();

  insertPendenz.run(
    'Buchhaltungsunterlagen Q2 bei Cafe Sonnenschein einfordern', mandanten.sonnenschein,
    'Unterlagen fuer die Buchhaltung Q2 sind noch nicht eingetroffen.',
    toISODate(addDays(heute, -5)), 'Hoch', 'Offen', 1, jetzt, null, null, null
  );

  insertPendenz.run(
    'Kontoauszuege Januar bei Mueller AG anfordern', mandanten.mueller,
    'Bankauszuege fuer die Januar-Buchhaltung fehlen noch.',
    toISODate(addDays(heute, 5)), 'Mittel', 'Warte auf Kunde', 0.5, jetzt, null,
    toISODate(addDays(heute, -10)), toISODate(addDays(heute, -1))
  );

  insertPendenz.run(
    'Offene Frage zur Vorsteuer bei Bergland Bau klaeren', mandanten.bergland,
    'Ruecksprache mit dem Steueramt zur Vorsteuerkuerzung noetig.',
    toISODate(addDays(heute, 2)), 'Mittel', 'In Arbeit', 2, jetzt, null, null, null
  );

  insertPendenz.run(
    'Bueromaterial bestellen', null,
    'Toner und Druckerpapier sind knapp.',
    toISODate(addDays(heute, 10)), 'Tief', 'Offen', null, jetzt, null, null, null
  );

  insertPendenz.run(
    'Jahresabschluss-Vorbesprechung mit Weber Immobilien terminieren', mandanten.weber,
    'Termin fuer die Vorbesprechung des Jahresabschlusses vereinbaren.',
    toISODate(addDays(heute, 3)), 'Mittel', 'Offen', 1, jetzt, null, null, null
  );

  insertPendenz.run(
    'MWST-Abrechnung Q1 nachkontrollieren', mandanten.mueller,
    'Stichprobenkontrolle der letzten Abrechnung.',
    toISODate(addDays(heute, -20)), 'Tief', 'Erledigt', 1.5, jetzt, toISODate(addDays(heute, -18)), null, null
  );

  // Beispiel fuer Teilaufgaben: eine Hauptaufgabe mit eigener Enddatum-Kette, deren
  // Zwischenschritte deutlich frueher als der finale Termin faellig sind.
  const insertPendenzMitEltern = db.prepare(`
    INSERT INTO pendenzen
      (titel, mandant_id, beschreibung, faelligkeit, prioritaet, status,
       aufwand_stunden, erstellt_am, erledigt_am, warte_seit, wiedervorlage, regel_id, perioden_schluessel, uebergeordnete_pendenz_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?)
  `);
  const jahresabschlussId = insertPendenzMitEltern.run(
    'Jahresabschluss 2026 bei Weber Immobilien AG einreichen', mandanten.weber, null,
    '2027-06-30', 'Hoch', 'Offen', 4, jetzt, null
  ).lastInsertRowid;
  insertPendenzMitEltern.run(
    'Buchhaltungsunterlagen bei Weber Immobilien anfordern', mandanten.weber, null,
    '2027-03-15', 'Mittel', 'Offen', 0.5, jetzt, jahresabschlussId
  );
  insertPendenzMitEltern.run(
    'Kontenabstimmung durchfuehren', mandanten.weber, null,
    '2027-05-15', 'Mittel', 'Offen', 3, jetzt, jahresabschlussId
  );
  insertPendenzMitEltern.run(
    'Entwurf Jahresabschluss dem Kunden vorlegen', mandanten.weber, null,
    '2027-06-15', 'Mittel', 'Offen', 1, jetzt, jahresabschlussId
  );

  const erzeugt = generiereFaelligePendenzen(db, heute);

  console.log('Seed abgeschlossen:');
  console.log(`  ${Object.keys(mandanten).length} Mandanten`);
  console.log('  8 Wiederkehr-Regeln');
  console.log('  10 manuelle Beispiel-Pendenzen (inkl. 1 Hauptaufgabe mit 3 Teilaufgaben)');
  console.log(`  ${erzeugt} automatisch generierte Pendenzen aus den Regeln`);

  db.close();
}

run();
