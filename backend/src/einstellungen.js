// SMTP-Einstellungen werden in der Datenbank (Tabelle app_einstellungen) gespeichert,
// damit sie auch auf einem Cloud-Server erhalten bleiben (die Datenbankdatei liegt dort
// auf einem persistenten Volume). Umgebungsvariablen (.env oder Plattform-Variablen)
// dienen als Startwert/Fallback.

const SMTP_SCHLUESSEL = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];

function leseRoh(db) {
  const werte = {};
  for (const { schluessel, wert } of db.prepare('SELECT schluessel, wert FROM app_einstellungen').all()) {
    werte[schluessel] = wert;
  }
  // Fehlende Schluessel aus der Umgebung ergaenzen.
  for (const s of SMTP_SCHLUESSEL) {
    if (werte[s] === undefined && process.env[s] !== undefined) werte[s] = process.env[s];
  }
  return werte;
}

/** Uebertraegt die in der DB gespeicherten Werte in process.env -- beim Serverstart aufrufen. */
function ladeEinstellungenInEnv(db) {
  const werte = leseRoh(db);
  for (const s of SMTP_SCHLUESSEL) {
    if (werte[s] !== undefined) process.env[s] = werte[s];
  }
}

/** SMTP-Konfiguration OHNE Passwortwert -- nur ob eines gesetzt ist. */
function leseSmtpEinstellungen(db) {
  const w = leseRoh(db);
  return {
    host: w.SMTP_HOST || '',
    port: w.SMTP_PORT || '587',
    secure: w.SMTP_SECURE === 'true',
    user: w.SMTP_USER || '',
    from: w.SMTP_FROM || '',
    passwortGesetzt: !!(w.SMTP_PASS && w.SMTP_PASS.length > 0),
  };
}

/**
 * Speichert die SMTP-Einstellungen in der DB und aktualisiert process.env, damit die
 * Aenderung sofort ohne Neustart wirkt. Ein leeres/fehlendes `passwort` laesst das
 * bestehende Passwort unveraendert.
 */
function speichereSmtpEinstellungen(db, { host, port, secure, user, from, passwort }) {
  const bisher = leseRoh(db);
  const neu = {
    SMTP_HOST: host ?? bisher.SMTP_HOST ?? '',
    SMTP_PORT: String(port ?? bisher.SMTP_PORT ?? '587'),
    SMTP_SECURE: secure ? 'true' : 'false',
    SMTP_USER: user ?? bisher.SMTP_USER ?? '',
    SMTP_FROM: from ?? bisher.SMTP_FROM ?? '',
    SMTP_PASS: (passwort && passwort.length > 0) ? passwort : (bisher.SMTP_PASS ?? ''),
  };

  const stmt = db.prepare(
    'INSERT INTO app_einstellungen (schluessel, wert) VALUES (?, ?) ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert'
  );
  for (const [k, v] of Object.entries(neu)) {
    stmt.run(k, v);
    process.env[k] = v;
  }
}

export { leseSmtpEinstellungen, speichereSmtpEinstellungen, ladeEinstellungenInEnv };
