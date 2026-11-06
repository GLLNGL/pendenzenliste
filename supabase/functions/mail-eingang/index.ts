// Auftraege per E-Mail (v7): holt alle Mails aus dem IMAP-Ordner "Auftraege" des Buero-Postfachs
// (in Outlook einfach Mails in diesen Ordner ziehen oder per Regel verschieben lassen), legt pro
// Mail eine Pendenz im Eingang an (geplant = false) und verschiebt die Mail danach nach
// "Auftraege/Uebernommen". Dieselbe Mail wird dank Message-ID nie doppelt uebernommen.
//
// Aufruf aus der App: supabase.functions.invoke('mail-eingang') -- nur angemeldete Personen
// (Supabase prueft das JWT). Gespeichert wird mit den Rechten der angemeldeten Person (RLS),
// ein Service-Schluessel ist nicht noetig.
//
// Secrets (Dashboard -> Edge Functions -> Secrets): die bestehenden SMTP_USER / SMTP_PASS
// (dasselbe Postfach) und optional
//   IMAP_HOST   (Standard: SMTP_HOST, bei Metanet z.B. sora.metanet.ch)
//   IMAP_PORT   (Standard: 993)
//   IMAP_ORDNER (Standard: "Aufträge")
// SUPABASE_URL und SUPABASE_ANON_KEY stellt Supabase automatisch bereit.

import { ImapFlow } from 'npm:imapflow@1.0.164';
import { simpleParser } from 'npm:mailparser@3.7.1';
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });

  const ordner = Deno.env.get('IMAP_ORDNER') || 'Aufträge';
  const client = new ImapFlow({
    host: Deno.env.get('IMAP_HOST') || Deno.env.get('SMTP_HOST') || '',
    port: Number(Deno.env.get('IMAP_PORT') || '993'),
    secure: true,
    auth: { user: Deno.env.get('SMTP_USER') ?? '', pass: Deno.env.get('SMTP_PASS') ?? '' },
    logger: false,
  });

  try {
    await client.connect();

    // Ordner anlegen, falls es ihn noch nicht gibt -- er erscheint dann auch in Outlook.
    const vorhanden = await client.list();
    const pfade = new Set(vorhanden.map((m) => m.path));
    const trenner = vorhanden[0]?.delimiter || '/';
    const ziel = `${ordner}${trenner}Übernommen`;
    if (!pfade.has(ordner)) {
      await client.mailboxCreate(ordner);
      await client.mailboxCreate(ziel);
      await client.logout();
      return antwort({ ok: true, neu: 0, hinweis: `Ordner «${ordner}» wurde angelegt – Mails dort hinein ziehen.` });
    }
    if (!pfade.has(ziel)) await client.mailboxCreate(ziel);

    const { data: mandanten } = await supabase.from('mandanten').select('id, name, email, geschaeftsfuehrung_email').eq('aktiv', true);

    const lock = await client.getMailboxLock(ordner);
    const uebernommen: string[] = [];
    const verschieben: number[] = [];
    try {
      const nachrichten = [];
      for await (const msg of client.fetch('1:*', { uid: true, source: true })) {
        nachrichten.push(msg);
        if (nachrichten.length >= MAX_PRO_ABRUF) break;
      }

      for (const msg of nachrichten) {
        const mail = await simpleParser(msg.source);
        const messageId = mail.messageId || `uid-${msg.uid}-${mail.date?.toISOString() ?? ''}`;
        const von = mail.from?.value?.[0];
        const vonAdresse = (von?.address ?? '').toLowerCase();
        const vonText = von ? (von.name ? `${von.name} <${von.address}>` : von.address) : 'unbekannt';

        // Mandant: exakte Adresse, sonst gleiche (geschaeftliche) Domain.
        const domain = domainVon(vonAdresse);
        const mandant = (mandanten ?? []).find((m) => [m.email, m.geschaeftsfuehrung_email].some((e) => e && e.toLowerCase() === vonAdresse))
          ?? (domain && !FREEMAIL.includes(domain)
            ? (mandanten ?? []).find((m) => [m.email, m.geschaeftsfuehrung_email].some((e) => domainVon(e) === domain))
            : undefined);

        const datum = mail.date ? mail.date.toLocaleString('de-CH', { timeZone: 'Europe/Zurich' }) : '';
        const text = (mail.text ?? '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
        const anhaenge = (mail.attachments ?? []).map((a) => a.filename).filter(Boolean);

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

      if (verschieben.length) await client.messageMove(verschieben, ziel, { uid: true });
    } finally {
      lock.release();
    }
    await client.logout();
    return antwort({ ok: true, neu: uebernommen.length, titel: uebernommen });
  } catch (err) {
    try { await client.logout(); } catch { /* Verbindung schon zu */ }
    return antwort({ fehler: err instanceof Error ? err.message : String(err) }, 500);
  }
});
