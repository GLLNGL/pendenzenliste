// E-Mail-Versand ueber das eigene SMTP-Konto des Benutzers. Zugangsdaten werden
// ausschliesslich aus lokalen Umgebungsvariablen (.env, nicht eingecheckt) gelesen --
// die App selbst speichert oder verschickt sie nirgendwo sonst hin.
import nodemailer from 'nodemailer';

function konfiguration() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  return {
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: SMTP_SECURE === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    from: SMTP_FROM || SMTP_USER,
  };
}

function istKonfiguriert() {
  return konfiguration() !== null;
}

let transporterCache = null;
let transporterSignatur = null;

function holeTransporter() {
  const config = konfiguration();
  if (!config) throw new Error('E-Mail-Versand ist nicht konfiguriert. Bitte in den Einstellungen hinterlegen.');
  const signatur = `${config.host}|${config.port}|${config.secure}|${config.auth.user}`;
  if (!transporterCache || transporterSignatur !== signatur) {
    transporterCache = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
    });
    transporterSignatur = signatur;
  }
  return { transporter: transporterCache, from: config.from };
}

function zuruecksetzenTransporter() {
  transporterCache = null;
  transporterSignatur = null;
}

async function sendeEmail({ an, betreff, text, anhaenge }) {
  const { transporter, from } = holeTransporter();
  await transporter.sendMail({ from, to: an, subject: betreff, text, attachments: anhaenge });
}

/** Schickt eine Testnachricht an die eigene Absenderadresse. Gibt die Zieladresse zurueck. */
async function sendeTestEmail() {
  const config = konfiguration();
  if (!config) throw new Error('E-Mail-Versand ist nicht konfiguriert.');
  const ziel = config.auth.user;
  await sendeEmail({
    an: ziel,
    betreff: 'Testnachricht Pendenzenliste',
    text: 'Diese Testnachricht bestaetigt, dass der E-Mail-Versand aus der Pendenzenliste funktioniert.',
  });
  return ziel;
}

export { istKonfiguriert, sendeEmail, sendeTestEmail, zuruecksetzenTransporter };
