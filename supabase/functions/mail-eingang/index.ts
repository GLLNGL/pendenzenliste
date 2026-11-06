// Auftraege per E-Mail (v7): holt alle Mails aus dem IMAP-Ordner "Auftraege" des Buero-Postfachs
// (in Outlook einfach Mails in diesen Ordner ziehen oder per Regel verschieben lassen), legt pro
// Mail eine Pendenz im Eingang an (geplant = false) und verschiebt die Mail danach nach
// "Auftraege/Uebernommen". Dieselbe Mail wird dank Message-ID nie doppelt uebernommen.
//
// Aufruf aus der App: supabase.functions.invoke('mail-eingang') -- nur angemeldete Personen
// (Supabase prueft das JWT). Gespeichert wird mit den Rechten der angemeldeten Person (RLS),
// ein Service-Schluessel ist nicht noetig.
//
// Secrets (Dashboard -> Edge Functions -> Secrets) -- das Buero-Postfach, aus dem die Auftraege
// kommen (unabhaengig vom Postfach fuer den Versand):
//   IMAP_HOST   z.B. sora.metanet.ch      (fehlt er: SMTP_HOST)
//   IMAP_USER   z.B. info@estcontrolling.ch (fehlt er: SMTP_USER)
//   IMAP_PASS   Passwort dieses Postfachs   (fehlt es: SMTP_PASS)
//   IMAP_PORT   optional, Standard 993
//   IMAP_ORDNER optional, Standard "Aufträge"
// SUPABASE_URL und SUPABASE_ANON_KEY stellt Supabase automatisch bereit.

import { ImapFlow } from 'npm:imapflow@1.0.164';
// postal-mime statt mailparser: rein JavaScript, laeuft zuverlaessig in Deno (mailparser blieb
// in der Supabase-Umgebung beim Zerlegen haengen).
import PostalMime from 'npm:postal-mime@2.3.2';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const MAX_PRO_ABRUF = 50;
// Bei diesen Domains sagt die Absender-Domain nichts ueber den Mandanten aus.
const FREEMAIL = ['gmail.com', 'gmx.ch', 'gmx.net', 'bluewin.ch', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'sunrise.ch', 'protonmail.com'];

function antwort(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

function domainVon(adresse: string | null | undefined) {
  const teile = String(adresse ?? '').toLowerCase().split('@');
  return teile.length === 2 ? teile[1] : '';
}

async function verarbeiten(req: Request, zustand: { schritt: string; client: ImapFlow | null }): Promise<Response> {

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });

  const ordner = Deno.env.get('IMAP_ORDNER') || 'Aufträge';
  const client = new ImapFlow({
    host: Deno.env.get('IMAP_HOST') || Deno.env.get('SMTP_HOST') || '',
    port: Number(Deno.env.get('IMAP_PORT') || '993'),
    secure: true,
    auth: {
      user: Deno.env.get('IMAP_USER') || Deno.env.get('SMTP_USER') || '',
      pass: Deno.env.get('IMAP_PASS') || Deno.env.get('SMTP_PASS') || '',
    },
    logger: false,
    // Antwortet der Mailserver nicht (z.B. voruebergehende Sperre nach vielen Anmeldungen),
    // nach kurzer Zeit abbrechen statt bis zum Zeitlimit von Supabase zu haengen.
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 45000,
  });

  zustand.client = client;
  zustand.schritt = 'Anmelden am Postfach';
  try {
    await client.connect();

    // Ordner suchen bzw. anlegen -- er erscheint dann auch in Outlook. Manche Server (z.B.
    // Metanet/Dovecot) legen eigene Ordner unter dem Posteingang ab ("INBOX.Auftraege"), darum
    // wird nach dem Ordnernamen auf oberster Ebene oder direkt unter INBOX gesucht und beim
    // Anlegen das Namensraum-Praefix des Servers verwendet.
    zustand.schritt = 'Ordner auflisten';
    let vorhanden = await client.list();
    const trenner = vorhanden[0]?.delimiter || '/';
    const oben = (m: { parentPath?: string }) => !m.parentPath || /^inbox$/i.test(m.parentPath);
    let quelle = vorhanden.find((m) => m.name === ordner && oben(m));
    let neuAngelegt = false;
    if (!quelle) {
      zustand.schritt = `Ordner «${ordner}» anlegen`;
      // deno-lint-ignore no-explicit-any
      const praefix = (client as any).namespace?.prefix ?? '';
      const erstellt = await client.mailboxCreate(`${praefix}${ordner}`);
      vorhanden = await client.list();
      quelle = vorhanden.find((m) => m.path === erstellt.path) ?? vorhanden.find((m) => m.name === ordner && oben(m));
      neuAngelegt = true;
    }
    const quellPfad = quelle?.path ?? ordner;
    let ziel = vorhanden.find((m) => m.name === 'Übernommen' && m.parentPath === quellPfad)?.path;
    zustand.schritt = 'Unterordner «Übernommen» anlegen';
    if (!ziel) ziel = (await client.mailboxCreate(`${quellPfad}${trenner}Übernommen`)).path;
    // Outlook zeigt bei IMAP-Postfaechern nur abonnierte Ordner -- darum beide abonnieren
    // (auch wenn sie schon existieren; mehrfaches Abonnieren schadet nicht).
    zustand.schritt = 'Ordner abonnieren';
    await client.mailboxSubscribe(quellPfad);
    await client.mailboxSubscribe(ziel);
    zustand.schritt = 'Mails lesen';
    if (neuAngelegt) {
      await client.logout();
      return antwort({ ok: true, neu: 0, ordner: quellPfad, hinweis: `Ordner «${ordner}» wurde im Postfach ${Deno.env.get('IMAP_USER') || Deno.env.get('SMTP_USER')} angelegt – Mails dort hinein ziehen.` });
    }

    zustand.schritt = 'Mandanten laden';
    const { data: mandanten } = await supabase.from('mandanten').select('id, name, email, geschaeftsfuehrung_email').eq('aktiv', true);

    zustand.schritt = 'Ordner öffnen';
    const lock = await client.getMailboxLock(quellPfad);
    zustand.schritt = 'Mails abrufen';
    const uebernommen: string[] = [];
    const verschieben: number[] = [];
    try {
      const nachrichten = [];
      // Leerer Ordner: manche Server (Dovecot) lehnen "1:*" dann als ungueltig ab.
      // deno-lint-ignore no-explicit-any
      const anzahl = (client as any).mailbox?.exists ?? 0;
      for await (const msg of (anzahl > 0 ? client.fetch('1:*', { uid: true, source: true }) : [])) {
        nachrichten.push(msg);
        if (nachrichten.length >= MAX_PRO_ABRUF) break;
      }

      for (const msg of nachrichten) {
        zustand.schritt = `Mail ${msg.uid} verarbeiten`;
        const mail = await PostalMime.parse(new Uint8Array(msg.source));
        const gesendet = mail.date ? new Date(mail.date) : null;
        const messageId = mail.messageId || `uid-${msg.uid}-${gesendet?.toISOString() ?? ''}`;
        const von = mail.from;
        const vonAdresse = (von?.address ?? '').toLowerCase();
        const vonText = von ? (von.name ? `${von.name} <${von.address}>` : von.address) : 'unbekannt';

        // Mandant: exakte Adresse, sonst gleiche (geschaeftliche) Domain.
        const domain = domainVon(vonAdresse);
        const mandant = (mandanten ?? []).find((m) => [m.email, m.geschaeftsfuehrung_email].some((e) => e && e.toLowerCase() === vonAdresse))
          ?? (domain && !FREEMAIL.includes(domain)
            ? (mandanten ?? []).find((m) => [m.email, m.geschaeftsfuehrung_email].some((e) => domainVon(e) === domain))
            : undefined);

        const datum = gesendet && !Number.isNaN(gesendet.getTime()) ? gesendet.toLocaleString('de-CH', { timeZone: 'Europe/Zurich' }) : '';
        // Nur-HTML-Mails: Tags entfernen, damit lesbarer Text in der Beschreibung steht.
        const rohtext = mail.text || (mail.html ?? '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
        const text = rohtext.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
        const anhaenge = (mail.attachments ?? []).map((a: { filename?: string | null }) => a.filename).filter(Boolean);

        const { error } = await supabase.from('pendenzen').insert({
          titel: (mail.subject ?? '').trim() || '(E-Mail ohne Betreff)',
          beschreibung: [
            `E-Mail von ${vonText}${datum ? ` am ${datum}` : ''}`,
            anhaenge.length ? `Anhänge: ${anhaenge.join(', ')}` : '',
            '',
            text,
          ].filter((z, i) => z || i === 2).join('\n'),
          mandant_id: mandant?.id ?? null,
          status: 'Offen',
          prioritaet: 'B',
          geplant: false,
          email_message_id: messageId,
          email_von: vonText,
        });
        // Bereits uebernommen (gleiche Message-ID): trotzdem wegschieben.
        if (error && !String(error.message).includes('idx_pendenzen_email_message_id')) throw new Error(error.message);
        if (!error) uebernommen.push(mail.subject ?? '');
        verschieben.push(msg.uid);
      }

      zustand.schritt = 'Mails nach «Übernommen» verschieben';
      if (verschieben.length) await client.messageMove(verschieben, ziel, { uid: true });
    } finally {
      lock.release();
    }
    await client.logout();
    return antwort({ ok: true, neu: uebernommen.length, titel: uebernommen, ordner: quellPfad, postfach: Deno.env.get('IMAP_USER') || Deno.env.get('SMTP_USER') });
  } catch (err) {
    try { await client.logout(); } catch { /* Verbindung schon zu */ }
    // imapflow liefert oft nur "Command failed" -- die eigentliche Server-Antwort steht in
    // responseText; bei falschem Passwort ist authenticationFailed gesetzt.
    // deno-lint-ignore no-explicit-any
    const e = err as any;
    const detail = e?.authenticationFailed
      ? 'Anmeldung abgelehnt – Benutzername oder Passwort (IMAP_USER/IMAP_PASS) prüfen.'
      : [e?.responseText, e?.serverResponseCode].filter(Boolean).join(' / ');
    return antwort({ fehler: `${zustand.schritt}: ${e?.message ?? String(err)}${detail ? ` (${detail})` : ''}` }, 500);
  }
}

// Notbremse: Haengt die Verbindung (Server antwortet nicht), nach 40 Sekunden abbrechen und den
// Schritt melden, statt bis zum Zeitlimit von Supabase (ohne Antwort) zu warten.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  const zustand: { schritt: string; client: ImapFlow | null } = { schritt: 'Start', client: null };
  let zeitgeber: number | undefined;
  const notbremse = new Promise<Response>((resolve) => {
    zeitgeber = setTimeout(() => {
      try { zustand.client?.close(); } catch { /* schon zu */ }
      resolve(antwort({ fehler: `Zeitüberschreitung (40 s) bei: ${zustand.schritt}` }, 504));
    }, 40000);
  });
  try {
    return await Promise.race([verarbeiten(req, zustand), notbremse]);
  } finally {
    clearTimeout(zeitgeber);
  }
});
