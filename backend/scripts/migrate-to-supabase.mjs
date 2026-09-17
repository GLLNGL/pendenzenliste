// Einmaliges Migrationsskript: liest die echten Daten aus der lokalen SQLite-Datei und schreibt
// sie ins Supabase-Projekt. Rein LESEND auf der SQLite-Seite -- es wird nichts an der lokalen
// Datenbank veraendert oder geloescht.
//
// Aufruf (im Ordner backend/):
//   node scripts/migrate-to-supabase.mjs
//
// Braucht eine Datei backend/scripts/service-role.local mit dem Supabase Service-Role-Key
// (eine einzige Zeile) -- NICHT der anon key, sondern der geheime "service_role"-Schluessel aus
// Project Settings -> API. Diese Datei ist per .gitignore ("*.local") ausgeschlossen.
//
// Reihenfolge wegen Fremdschluesseln: mandanten -> mitarbeitende-Zuordnung (per E-Mail an
// bestehende Supabase-Auth-Konten) -> wiederkehr_regeln -> pendenzen (erst Hauptaufgaben, dann
// Teilaufgaben) -> pendenz_emails -> pendenz_notizen. Alte IDs werden fuer
// mandanten/wiederkehr_regeln/pendenzen/pendenz_emails/pendenz_notizen 1:1 uebernommen (die
// Supabase-Tabellen sind vor der Migration leer), damit alle Fremdschluessel-Bezuege ohne
// Umrechnung erhalten bleiben. mitarbeitende-IDs koennen NICHT 1:1 uebernommen werden, weil die
// Supabase-Tabelle durch den Login-Trigger schon eigene IDs vergeben hat -- dafuer wird eine
// Umrechnungstabelle (alte ID -> neue ID, ueber die E-Mail-Adresse) aufgebaut.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { openDatabase, DEFAULT_DB_PATH } from '../src/db.js';

const SUPABASE_URL = 'https://ignougkatusvknaqyfve.supabase.co';

function ladeServiceRoleKey() {
  try {
    return readFileSync(new URL('./service-role.local', import.meta.url), 'utf8').trim();
  } catch {
    console.error('Fehlt: backend/scripts/service-role.local mit dem Supabase Service-Role-Key (eine Zeile). Siehe Kommentar oben im Skript.');
    process.exit(1);
  }
}

const db = openDatabase(DEFAULT_DB_PATH);
const supabase = createClient(SUPABASE_URL, ladeServiceRoleKey());

function alle(sql) {
  return db.prepare(sql).all();
}

async function einfuegen(tabelle, zeilen, beschriftung) {
  if (zeilen.length === 0) {
    console.log(`- ${beschriftung}: keine Zeilen, uebersprungen.`);
    return;
  }
  const { error } = await supabase.from(tabelle).insert(zeilen);
  if (error) throw new Error(`${beschriftung}: ${error.message}`);
  console.log(`- ${beschriftung}: ${zeilen.length} Zeile(n) uebertragen.`);
}

async function migriere() {
  // 1) mandanten -- IDs 1:1 uebernommen (Zieltabelle ist leer).
  const mandanten = alle('SELECT * FROM mandanten').map((m) => ({
    id: m.id, name: m.name, kuerzel: m.kuerzel, email: m.email,
    geschaeftsfuehrung_email: m.geschaeftsfuehrung_email, aktiv: !!m.aktiv, notizen: m.notizen,
  }));
  await einfuegen('mandanten', mandanten, 'Mandanten');

  // 2) mitarbeitende -- KEINE 1:1-IDs. Bestehende Supabase-Zeile (durch Login-Anlage im
  // Dashboard erzeugt) per E-Mail finden und Alt-ID -> Neu-ID vermerken; ohne Treffer (Person
  // ohne Login) neue Zeile anlegen.
  const alteMitarbeitende = alle('SELECT * FROM mitarbeitende');
  const { data: neueMitarbeitende, error: mitarbeitendeFehler } = await supabase.from('mitarbeitende').select('id, email');
  if (mitarbeitendeFehler) throw new Error(`mitarbeitende lesen: ${mitarbeitendeFehler.message}`);

  const mitarbeiterIdMap = new Map(); // alte id -> neue id
  for (const alt of alteMitarbeitende) {
    const treffer = alt.email && neueMitarbeitende.find((n) => n.email?.toLowerCase() === alt.email.toLowerCase());
    if (treffer) {
      mitarbeiterIdMap.set(alt.id, treffer.id);
      await supabase.from('mitarbeitende').update({ aktiv: !!alt.aktiv }).eq('id', treffer.id);
    } else {
      const { data, error } = await supabase.from('mitarbeitende')
        .insert({ name: alt.name, email: alt.email, aktiv: !!alt.aktiv }).select('id').single();
      if (error) throw new Error(`mitarbeitende (ohne Login) anlegen: ${error.message}`);
      mitarbeiterIdMap.set(alt.id, data.id);
    }
  }
  console.log(`- Mitarbeitende: ${alteMitarbeitende.length} zugeordnet/angelegt.`);

  // 3) wiederkehr_regeln -- IDs 1:1, faelligkeit_config von JSON-Text zu jsonb.
  const regeln = alle('SELECT * FROM wiederkehr_regeln').map((r) => ({
    id: r.id, titel_vorlage: r.titel_vorlage, mandant_id: r.mandant_id, rhythmus: r.rhythmus,
    faelligkeit_typ: r.faelligkeit_typ, faelligkeit_config: JSON.parse(r.faelligkeit_config || '{}'),
    vorlauf_tage: r.vorlauf_tage, aktiv: !!r.aktiv,
  }));
  await einfuegen('wiederkehr_regeln', regeln, 'Wiederkehr-Regeln');

  // 4) pendenzen -- erst Hauptaufgaben (uebergeordnete_pendenz_id IS NULL), danach Teilaufgaben,
  // wegen der selbstreferenzierenden Fremdschluessel und weil der Status-Kaskade-Trigger beim
  // Einfuegen einer Teilaufgabe die Hauptaufgabe bereits vorfinden muss.
  const allePendenzen = alle('SELECT * FROM pendenzen');
  function pendenzZeile(p) {
    return {
      id: p.id, titel: p.titel, mandant_id: p.mandant_id, beschreibung: p.beschreibung,
      faelligkeit: p.faelligkeit, prioritaet: p.prioritaet, status: p.status,
      aufwand_stunden: p.aufwand_stunden, erstellt_am: p.erstellt_am, erledigt_am: p.erledigt_am,
      warte_seit: p.warte_seit, wiedervorlage: p.wiedervorlage, regel_id: p.regel_id,
      perioden_schluessel: p.perioden_schluessel, uebergeordnete_pendenz_id: p.uebergeordnete_pendenz_id,
      bearbeiter_id: p.bearbeiter_id != null ? mitarbeiterIdMap.get(p.bearbeiter_id) ?? null : null,
    };
  }
  const hauptaufgaben = allePendenzen.filter((p) => !p.uebergeordnete_pendenz_id).map(pendenzZeile);
  const teilaufgaben = allePendenzen.filter((p) => p.uebergeordnete_pendenz_id).map(pendenzZeile);
  await einfuegen('pendenzen', hauptaufgaben, 'Pendenzen (Hauptaufgaben)');
  await einfuegen('pendenzen', teilaufgaben, 'Pendenzen (Teilaufgaben)');

  // 5) pendenz_emails -- IDs 1:1.
  const emails = alle('SELECT * FROM pendenz_emails').map((e) => ({
    id: e.id, pendenz_id: e.pendenz_id, an: e.an, betreff: e.betreff, gesendet_am: e.gesendet_am,
  }));
  await einfuegen('pendenz_emails', emails, 'E-Mail-Verlauf');

  // 6) pendenz_notizen -- IDs 1:1, mitarbeiter_id via Umrechnungstabelle.
  const notizen = alle('SELECT * FROM pendenz_notizen').map((n) => ({
    id: n.id, pendenz_id: n.pendenz_id, text: n.text,
    mitarbeiter_id: n.mitarbeiter_id != null ? mitarbeiterIdMap.get(n.mitarbeiter_id) ?? null : null,
    erstellt_am: n.erstellt_am,
  }));
  await einfuegen('pendenz_notizen', notizen, 'Notizen');

  console.log('\nFertig. Wichtig: jetzt im SQL Editor die Sequenzen hochsetzen (siehe Chat).');
}

migriere()
  .catch((err) => {
    console.error('\nFEHLER, Migration abgebrochen:', err.message);
    console.error('Die SQLite-Datei wurde nicht veraendert. Bereits uebertragene Zeilen in Supabase muessten vor einem erneuten Lauf ggf. manuell bereinigt werden.');
    process.exitCode = 1;
  })
  .finally(() => db.close());
