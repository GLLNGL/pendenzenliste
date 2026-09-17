import 'dotenv/config';
import { openDatabase, DEFAULT_DB_PATH } from './db.js';
import { erstelleApp } from './app.js';
import { generiereFaelligePendenzen } from './generate.js';
import { toISODate, heutigesDatumUTC } from './recurrence.js';
import { ladeEinstellungenInEnv } from './einstellungen.js';

const PORT = process.env.PORT || 3001;

const db = openDatabase(DEFAULT_DB_PATH);
ladeEinstellungenInEnv(db); // in der DB gespeicherte SMTP-Zugangsdaten aktivieren

let letzterLaufISO = null;
function taeglicherLauf() {
  const heuteISO = toISODate(heutigesDatumUTC());
  if (heuteISO === letzterLaufISO) return;
  const erzeugt = generiereFaelligePendenzen(db);
  letzterLaufISO = heuteISO;
  console.log(`Wiederkehr-Regeln geprueft (${heuteISO}): ${erzeugt} neue Pendenz(en) erzeugt.`);
}

taeglicherLauf();
// Stuendliche Pruefung reicht aus, um einen Tageswechsel zuverlaessig zu erkennen,
// ohne eine zusaetzliche Cron-Abhaengigkeit einzufuehren.
setInterval(taeglicherLauf, 60 * 60 * 1000);

const app = erstelleApp(db);
app.listen(PORT, () => {
  console.log(`Pendenzenliste-Backend laeuft auf http://localhost:${PORT}`);
  console.log('Adressen fuer den Handy-Zugriff stehen in der App unter "Einstellungen".');
});
