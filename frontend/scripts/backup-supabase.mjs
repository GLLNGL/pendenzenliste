// Datensicherung vor Schema-Änderungen: liest ALLE Tabellen der Pendenzenliste rein lesend aus
// Supabase und schreibt sie als eine JSON-Datei in den Ordner "backups/" im Projektstamm (per
// .gitignore ausgeschlossen -- das Repository ist öffentlich, Mandantendaten gehören nie dorthin).
//
// Aufruf (im Ordner frontend/):
//   node scripts/backup-supabase.mjs
//
// Braucht denselben Service-Role-Key wie das Migrationsskript (backend/scripts/service-role.local,
// eine Zeile) -- damit RLS umgangen wird und wirklich alle Zeilen gelesen werden. Es wird nichts
// geschrieben oder gelöscht.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const TABELLEN = ['mitarbeitende', 'mandanten', 'wiederkehr_regeln', 'pendenzen', 'pendenz_emails', 'pendenz_notizen'];
const SEITENGROESSE = 1000;

function ladeEnvLocal() {
  const inhalt = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  const werte = {};
  for (const zeile of inhalt.split('\n')) {
    const [schluessel, ...rest] = zeile.split('=');
    if (schluessel && rest.length) werte[schluessel.trim()] = rest.join('=').trim();
  }
  return werte;
}

function ladeServiceRoleKey() {
  try {
    return readFileSync(new URL('../../backend/scripts/service-role.local', import.meta.url), 'utf8').trim();
  } catch {
    console.error('Fehlt: backend/scripts/service-role.local mit dem Supabase Service-Role-Key (eine Zeile).');
    process.exit(1);
  }
}

// PostgREST liefert pro Abfrage höchstens ~1000 Zeilen -- darum seitenweise lesen, bis eine
// Seite kürzer als die Seitengrösse ist.
async function alleZeilen(supabase, tabelle) {
  const zeilen = [];
  for (let von = 0; ; von += SEITENGROESSE) {
    const { data, error } = await supabase.from(tabelle).select('*').order('id').range(von, von + SEITENGROESSE - 1);
    if (error) throw new Error(`${tabelle}: ${error.message}`);
    zeilen.push(...data);
    if (data.length < SEITENGROESSE) return zeilen;
  }
}

async function sichern() {
  const { VITE_SUPABASE_URL } = ladeEnvLocal();
  const supabase = createClient(VITE_SUPABASE_URL, ladeServiceRoleKey(), { auth: { persistSession: false } });

  const sicherung = { erstellt_am: new Date().toISOString(), tabellen: {} };
  for (const tabelle of TABELLEN) {
    sicherung.tabellen[tabelle] = await alleZeilen(supabase, tabelle);
    console.log(`- ${tabelle}: ${sicherung.tabellen[tabelle].length} Zeile(n)`);
  }

  const ordner = new URL('../../backups/', import.meta.url);
  mkdirSync(ordner, { recursive: true });
  const zeitstempel = sicherung.erstellt_am.slice(0, 16).replace(/[:T]/g, '-');
  const datei = new URL(`supabase-${zeitstempel}.json`, ordner);
  writeFileSync(datei, JSON.stringify(sicherung, null, 2), 'utf8');
  console.log(`\nGesichert nach: ${decodeURIComponent(datei.pathname).replace(/^\/([A-Za-z]:)/, '$1')}`);
}

sichern().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});
