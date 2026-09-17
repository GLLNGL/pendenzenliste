// Leert die Datenbank vollstaendig (Mandanten, Regeln, Pendenzen) OHNE Beispieldaten
// nachzufuellen -- im Unterschied zu seed.js. Fuer den Start mit echten eigenen Daten.
import { openDatabase, DEFAULT_DB_PATH } from './db.js';

function run() {
  const db = openDatabase(DEFAULT_DB_PATH);

  db.exec('DELETE FROM pendenzen');
  db.exec('DELETE FROM wiederkehr_regeln');
  db.exec('DELETE FROM mandanten');
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('pendenzen', 'wiederkehr_regeln', 'mandanten')");

  console.log('Datenbank geleert. Alle Beispieldaten wurden entfernt.');
  db.close();
}

run();
