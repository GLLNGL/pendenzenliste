// Einmaliger, isolierter Verbindungstest fuer die Supabase-Migration (Phase 2) -- rein lesend,
// greift NICHT in die laufende App ein. Prueft: Login funktioniert, der handle_new_user-Trigger
// hat die mitarbeitende-Zeile korrekt angelegt, RLS laesst eine angemeldete Person lesen, und
// RLS blockiert eine NICHT angemeldete Person.
//
// Aufruf (immer derselbe, keine Anpassung in der Kommandozeile noetig):
//   node scripts/test-supabase.mjs
//
// Login-Daten kommen aus der Datei "test-login.local" in diesem Ordner (per .gitignore
// ausgeschlossen, "*.local"). Datei mit Notepad anlegen, genau 2 Zeilen:
//   deine@email.ch
//   deinPasswort

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function ladeEnvLocal() {
  const inhalt = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  const werte = {};
  for (const zeile of inhalt.split('\n')) {
    const [schluessel, ...rest] = zeile.split('=');
    if (schluessel && rest.length) werte[schluessel.trim()] = rest.join('=').trim();
  }
  return werte;
}

const { VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY } = ladeEnvLocal();

let email = process.env.TEST_EMAIL;
let passwort = process.env.TEST_PASSWORT;

if (!email || !passwort) {
  try {
    const zeilen = readFileSync(new URL('../test-login.local', import.meta.url), 'utf8')
      .split('\n').map((z) => z.trim()).filter(Boolean);
    [email, passwort] = zeilen;
  } catch {
    // Datei fehlt -- Fehlermeldung unten deckt beide Wege (Datei oder Umgebungsvariablen) ab.
  }
}

if (!email || !passwort) {
  console.error('Bitte im Ordner "frontend" eine Datei "test-login.local" anlegen mit 2 Zeilen: E-Mail, dann Passwort (siehe Kommentar oben).');
  process.exit(1);
}

async function test() {
  console.log('1) Anmeldung als', email, '...');
  const angemeldet = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY);
  const { data: loginDaten, error: loginFehler } = await angemeldet.auth.signInWithPassword({ email, password: passwort });
  if (loginFehler) {
    console.error('   FEHLER beim Login:', loginFehler.message);
    return;
  }
  console.log('   OK -- angemeldet als User-ID', loginDaten.user.id);

  console.log('2) Eigene mitarbeitende-Zeile lesen (prueft handle_new_user-Trigger) ...');
  const { data: mitarbeiterZeile, error: mitarbeiterFehler } = await angemeldet
    .from('mitarbeitende').select('*').eq('id', loginDaten.user.id).single();
  if (mitarbeiterFehler) {
    console.error('   FEHLER:', mitarbeiterFehler.message);
  } else {
    console.log('   OK --', JSON.stringify(mitarbeiterZeile));
  }

  console.log('3) mandanten lesen als angemeldete Person (sollte funktionieren, Liste ist noch leer) ...');
  const { data: mandantenAlsAngemeldet, error: mandantenFehler } = await angemeldet.from('mandanten').select('*');
  if (mandantenFehler) {
    console.error('   FEHLER:', mandantenFehler.message);
  } else {
    console.log(`   OK -- ${mandantenAlsAngemeldet.length} Zeile(n) gelesen (0 ist normal, noch keine Daten migriert).`);
  }

  console.log('4) mandanten lesen OHNE Anmeldung (muss von RLS blockiert werden / leer sein) ...');
  const anonym = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY);
  const { data: mandantenAnonym, error: anonymFehler } = await anonym.from('mandanten').select('*');
  if (anonymFehler) {
    console.log('   OK -- RLS hat abgelehnt:', anonymFehler.message);
  } else if (mandantenAnonym.length === 0) {
    console.log('   OK -- RLS liefert 0 Zeilen ohne Anmeldung (korrekt).');
  } else {
    console.error('   PROBLEM: ohne Anmeldung wurden Daten sichtbar! RLS-Policy pruefen.');
  }

  await angemeldet.auth.signOut();
  console.log('\nFertig.');
}

test();
