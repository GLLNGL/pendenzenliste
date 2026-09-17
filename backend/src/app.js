import express from 'express';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import mandantenRouter from './routes/mandanten.js';
import pendenzenRouter from './routes/pendenzen.js';
import regelnRouter from './routes/regeln.js';
import mitarbeitendeRouter from './routes/mitarbeitende.js';
import authRouter from './routes/auth.js';
import { authMiddleware } from './auth.js';
import { STATUS_WERTE, PRIORITAETEN } from './constants.js';
import { RHYTHMEN, FAELLIGKEIT_TYPEN } from './recurrence.js';
import { generiereFaelligePendenzen } from './generate.js';
import { istKonfiguriert, sendeEmail, sendeTestEmail, zuruecksetzenTransporter } from './mail.js';
import { baueICS, dateinameFuer } from './ics.js';
import { leseSmtpEinstellungen, speichereSmtpEinstellungen } from './einstellungen.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = join(__dirname, '..', '..', 'frontend', 'dist');

function erstelleApp(db) {
  const app = express();
  app.locals.db = db;
  // Hinter einem Reverse-Proxy (Cloud-Hosting) korrekte Protokoll-/IP-Erkennung.
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(cookieParser());

  // Login-Routen sind offen, alles andere unter /api/* erfordert eine Anmeldung.
  app.use('/api/auth', authRouter);
  app.use(authMiddleware(db));

  app.get('/api/meta', (req, res) => {
    res.json({ statusWerte: STATUS_WERTE, prioritaeten: PRIORITAETEN, rhythmen: RHYTHMEN, faelligkeitTypen: FAELLIGKEIT_TYPEN });
  });

  app.post('/api/generieren', (req, res) => {
    const erzeugt = generiereFaelligePendenzen(db);
    res.json({ erzeugt });
  });

  app.get('/api/mail/status', (req, res) => {
    res.json({ konfiguriert: istKonfiguriert() });
  });

  // SMTP-Einstellungen -- Passwort wird nie zurueckgegeben, nur ob eines gesetzt ist.
  app.get('/api/einstellungen/smtp', (req, res) => {
    res.json(leseSmtpEinstellungen(db));
  });

  app.put('/api/einstellungen/smtp', (req, res) => {
    const { host, port, secure, user, from, passwort } = req.body;
    try {
      speichereSmtpEinstellungen(db, { host, port, secure, user, from, passwort });
      zuruecksetzenTransporter();
      res.json({ gespeichert: true, ...leseSmtpEinstellungen(db) });
    } catch (err) {
      console.error('SMTP-Einstellungen speichern fehlgeschlagen:', err);
      res.status(500).json({ fehler: 'Einstellungen konnten nicht gespeichert werden: ' + err.message });
    }
  });

  // Erreichbare Adressen fuer den Zugriff vom Handy / aus dem Netzwerk.
  app.get('/api/einstellungen/netzwerk', (req, res) => {
    const port = Number(process.env.PORT) || 3001;
    const lan = [];
    const tailscale = [];
    // Virtuelle Adapter (WSL, Hyper-V, Docker, VMware, VirtualBox) ausblenden -- die
    // sind vom Handy nicht erreichbar.
    // NordLynx = NordVPN, WireGuard = generische VPN-Clients -- deren Adressen sind reine
    // Tunnel-Adressen, ueber die man das Geraet nie im lokalen Netz erreicht.
    const virtuell = /vethernet|wsl|hyper-v|docker|vmware|virtualbox|loopback|nordlynx|nordvpn|wireguard|openvpn/i;

    for (const [name, eintraege] of Object.entries(networkInterfaces())) {
      if (virtuell.test(name)) continue;
      for (const e of eintraege ?? []) {
        if (e.family !== 'IPv4' || e.internal) continue;
        if (e.address.startsWith('169.254.')) continue; // Link-Local (kein DHCP)
        // Tailscale nutzt den CGNAT-Bereich 100.64.0.0 - 100.127.255.255.
        const zweitesOktett = Number(e.address.split('.')[1]);
        if (e.address.startsWith('100.') && zweitesOktett >= 64 && zweitesOktett <= 127) {
          tailscale.push(`http://${e.address}:${port}`);
        } else {
          lan.push(`http://${e.address}:${port}`);
        }
      }
    }
    res.json({ port, lan, tailscale });
  });

  app.post('/api/mail/test', async (req, res) => {
    if (!istKonfiguriert()) {
      return res.status(400).json({ fehler: 'E-Mail-Versand ist nicht konfiguriert.' });
    }
    try {
      const ziel = await sendeTestEmail();
      res.json({ gesendet: true, an: ziel });
    } catch (err) {
      console.error('Test-E-Mail fehlgeschlagen:', err);
      res.status(502).json({ fehler: err.message });
    }
  });

  app.post('/api/mail/senden', async (req, res) => {
    const { an, betreff, text, kalender, pendenzId } = req.body;
    if (!an || !betreff || !text) {
      return res.status(400).json({ fehler: 'Empfaenger, Betreff und Text sind erforderlich' });
    }
    if (!istKonfiguriert()) {
      return res.status(400).json({ fehler: 'E-Mail-Versand ist nicht konfiguriert. Bitte unter "Einstellungen" hinterlegen.' });
    }
    try {
      let anhaenge;
      if (kalender && kalender.titel && kalender.faelligkeit) {
        const ics = baueICS(kalender);
        anhaenge = [{ filename: dateinameFuer(kalender.titel), content: ics, contentType: 'text/calendar' }];
      }
      await sendeEmail({ an, betreff, text, anhaenge });
      // Protokollieren, damit in der Pendenz sichtbar ist, dass (und an wen) bereits gemailt
      // wurde -- nur wenn die Mail zu einer Pendenz gehoert (nicht z.B. die Test-Mail).
      if (pendenzId) {
        db.prepare('INSERT INTO pendenz_emails (pendenz_id, an, betreff, gesendet_am) VALUES (?, ?, ?, ?)')
          .run(pendenzId, an, betreff, new Date().toISOString());
      }
      res.json({ gesendet: true });
    } catch (err) {
      console.error('E-Mail-Versand fehlgeschlagen:', err);
      res.status(502).json({ fehler: 'E-Mail konnte nicht gesendet werden: ' + err.message });
    }
  });

  app.use('/api/mandanten', mandantenRouter);
  app.use('/api/pendenzen', pendenzenRouter);
  app.use('/api/regeln', regelnRouter);
  app.use('/api/mitarbeitende', mitarbeitendeRouter);

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ fehler: 'Route nicht gefunden' });
    next();
  });

  // Fertig gebautes Frontend (npm run build) mitausliefern, damit ein einzelner
  // Serverprozess fuer den Desktop-Start reicht -- kein separater Vite-Dev-Server noetig.
  // Im reinen Entwicklungsmodus (kein dist/-Ordner) bleibt dieser Teil inaktiv.
  if (existsSync(FRONTEND_DIST)) {
    app.use(express.static(FRONTEND_DIST));
    app.get(/.*/, (req, res) => {
      res.sendFile(join(FRONTEND_DIST, 'index.html'));
    });
  } else {
    app.use((req, res) => {
      res.status(404).json({ fehler: 'Route nicht gefunden' });
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ fehler: 'Interner Serverfehler' });
  });

  return app;
}

export { erstelleApp };
