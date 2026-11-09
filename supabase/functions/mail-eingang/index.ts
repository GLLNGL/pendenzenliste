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
//   ANTHROPIC_API_KEY  Claude-API-Schluessel: jede Mail wird zusammengefasst und die To-dos
//                      werden als Teilschritte angelegt. Fehlt er (oder schlaegt die Auswertung
//                      fehl), wird die Mail wie bisher unveraendert uebernommen.
// SUPABASE_URL und SUPABASE_ANON_KEY stellt Supabase automatisch bereit.

import { ImapFlow } from 'npm:imapflow@1.0.164';
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
// postal-mime statt mailparser: rein JavaScript, laeuft zuverlaessig in Deno (mailparser blieb
// in der Supabase-Umgebung beim Zerlegen haengen).
import PostalMime from 'npm:postal-mime@2.3.2';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
// Pro Abruf hoechstens so viele Mails (die KI-Auswertung braucht einige Sekunden pro Mail);
// der Rest folgt beim naechsten Abruf.
const MAX_PRO_ABRUF = 5;
const NOTBREMSE_MS = 120000;

// --------------------------------------------------------------------------------------------
// KI-Auswertung (Claude): Zusammenfassung und To-dos als strukturiertes JSON.
// --------------------------------------------------------------------------------------------
const anthropicSchluessel = Deno.env.get('ANTHROPIC_API_KEY');
const anthropic = anthropicSchluessel ? new Anthropic({ apiKey: anthropicSchluessel }) : null;

type Auswertung = {
  titel: string;
  zusammenfassung: string;
  prioritaet: 'A' | 'B' | 'C';
  todos: { text: string; frist: string | null }[];
};

const AUSWERTUNG_SCHEMA = {
  type: 'object',
  properties: {
    titel: { type: 'string', description: 'Kurzer Titel des Auftrags, höchstens 80 Zeichen' },
    zusammenfassung: { type: 'string', description: '2 bis 5 sachliche Sätze' },
    prioritaet: { type: 'string', enum: ['A', 'B', 'C'] },
    todos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Konkreter nächster Schritt: Verb + Objekt' },
          frist: { type: ['string', 'null'], description: 'YYYY-MM-DD, nur wenn in der Mail genannt' },
        },
        required: ['text', 'frist'],
        additionalProperties: false,
      },
    },
  },
  required: ['titel', 'zusammenfassung', 'prioritaet', 'todos'],
  additionalProperties: false,
};

const SYSTEM_AUSWERTUNG = `Du arbeitest für ein Schweizer Treuhandbüro (Buchhaltung, Lohn, MWST, Abschlüsse, Controlling). Du erhältst eine E-Mail, die als Auftrag ins Büro gekommen ist, und bereitest sie für die Pendenzenliste auf. Schreibe auf Deutsch (Schweiz), mit «ss» statt «ß».

- titel: worum es geht, als kurzer Auftragstitel (z.B. «Revisionsberichte 2021–2023 prüfen»), keine Betreff-Präfixe wie «AW:» oder «I:».
- zusammenfassung: das Wesentliche in 2 bis 5 Sätzen – wer will was bis wann, welche Unterlagen liegen bei.
- todos: die konkreten Arbeitsschritte, die das Treuhandbüro daraus erledigen muss, je ein kurzer Satz, der mit einem Verb beginnt («Lohnausweise 2025 erstellen»). Nur echte Aufgaben für das Büro, nicht für den Absender. Ist nichts zu tun (reine Information), eine leere Liste.
- frist: ein Datum nur, wenn die Mail eines nennt oder eindeutig vorgibt; sonst null.
- prioritaet: A bei Dringlichkeit oder einer Frist in den nächsten 5 Arbeitstagen, C bei reiner Information, sonst B.`;

async function auswerten(eingabe: { betreff: string; von: string; datum: string; anhaenge: string[]; text: string; heute: string }): Promise<Auswertung | null> {
  if (!anthropic) return null;
  try {
    const antwortKi = await anthropic.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      // Lehnt ein Sicherheitsfilter ab, uebernimmt automatisch ein anderes Modell.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: AUSWERTUNG_SCHEMA } },
      system: SYSTEM_AUSWERTUNG,
      messages: [{
        role: 'user',
        content: [
          `Heute ist ${eingabe.heute}.`,
          `Von: ${eingabe.von}`,
          eingabe.datum ? `Gesendet: ${eingabe.datum}` : '',
          `Betreff: ${eingabe.betreff}`,
          eingabe.anhaenge.length ? `Anhänge: ${eingabe.anhaenge.join(', ')}` : '',
          '',
          eingabe.text || '(kein Text)',
        ].filter((z, i) => z || i === 5).join('\n'),
      }],
    // deno-lint-ignore no-explicit-any
    } as any, { timeout: 60000, maxRetries: 1 });
    if (antwortKi.stop_reason === 'refusal' || antwortKi.stop_reason === 'max_tokens') return null;
    const block = antwortKi.content.find((b: { type: string }) => b.type === 'text') as { text: string } | undefined;
    if (!block) return null;
    const ergebnis = JSON.parse(block.text) as Auswertung;
    return ergebnis?.titel ? ergebnis : null;
  } catch (err) {
    console.error('KI-Auswertung fehlgeschlagen:', err instanceof Error ? err.message : err);
    return null;
  }
}
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
        const volltext = rohtext.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        // Eingebettete Signatur-Bilder (image001.png ...) sind keine echten Anhaenge.
        const anhaenge = (mail.attachments ?? [])
          .map((a: { filename?: string | null }) => a.filename)
          .filter((n: string | null | undefined) => n && !/^image\d+\.(gif|png|jpe?g)$/i.test(n)) as string[];
        const betreff = (mail.subject ?? '').trim() || '(E-Mail ohne Betreff)';

        // Schon uebernommen (gleiche Message-ID)? Dann keine erneute KI-Auswertung.
        const { data: schon } = await supabase.from('pendenzen').select('id').eq('email_message_id', messageId).maybeSingle();
        if (schon) { verschieben.push(msg.uid); continue; }

        zustand.schritt = `Mail ${msg.uid} zusammenfassen`;
        const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' });
        const ki = await auswerten({ betreff, von: vonText, datum, anhaenge, text: volltext, heute });

        const herkunft = [
          `E-Mail von ${vonText}${datum ? ` am ${datum}` : ''}`,
          `Betreff: ${betreff}`,
          anhaenge.length ? `Anhänge: ${anhaenge.join(', ')}` : '',
          'Original in Outlook unter «Aufträge › Übernommen».',
        ].filter(Boolean).join('\n');
        const fristen = (ki?.todos ?? []).map((t) => t.frist).filter((f): f is string => !!f && /^\d{4}-\d{2}-\d{2}$/.test(f)).sort();

        zustand.schritt = `Mail ${msg.uid} speichern`;
        const { data: kopf, error } = await supabase.from('pendenzen').insert({
          titel: (ki?.titel || betreff).slice(0, 200),
          beschreibung: ki ? `${ki.zusammenfassung}\n\n${herkunft}` : `${herkunft}\n\n${volltext.slice(0, 4000)}`,
          mandant_id: mandant?.id ?? null,
          status: 'Offen',
          prioritaet: ki?.prioritaet ?? 'B',
          faelligkeit: fristen[0] ?? null,
          geplant: false,
          email_message_id: messageId,
          email_von: vonText,
        }).select('id').single();
        // Bereits uebernommen (gleichzeitiger Abruf): trotzdem wegschieben.
        if (error && !String(error.message).includes('idx_pendenzen_email_message_id')) throw new Error(error.message);

        // To-dos als Teilschritte (noch im Eingang, werden mit dem Projekt eingeplant).
        if (kopf && ki?.todos?.length) {
          for (const todo of ki.todos) {
            const frist = todo.frist && /^\d{4}-\d{2}-\d{2}$/.test(todo.frist) ? todo.frist : null;
            const { error: fehlerSchritt } = await supabase.from('pendenzen').insert({
              titel: todo.text.slice(0, 200), uebergeordnete_pendenz_id: kopf.id, mandant_id: mandant?.id ?? null,
              status: 'Offen', prioritaet: ki.prioritaet ?? 'B', faelligkeit: frist, geplant: false,
            });
            if (fehlerSchritt) throw new Error(fehlerSchritt.message);
          }
        }
        if (!error) uebernommen.push(ki?.titel || betreff);
        verschieben.push(msg.uid);
      }

      zustand.schritt = 'Mails nach «Übernommen» verschieben';
      if (verschieben.length) await client.messageMove(verschieben, ziel, { uid: true });
    } finally {
      lock.release();
    }
    await client.logout();
    return antwort({ ok: true, neu: uebernommen.length, titel: uebernommen, ordner: quellPfad, ki: !!anthropic, postfach: Deno.env.get('IMAP_USER') || Deno.env.get('SMTP_USER') });
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

// Notbremse: Haengt etwas (Server antwortet nicht), nach 120 Sekunden abbrechen und den
// Schritt melden, statt bis zum Zeitlimit von Supabase (ohne Antwort) zu warten.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  const zustand: { schritt: string; client: ImapFlow | null } = { schritt: 'Start', client: null };
  let zeitgeber: number | undefined;
  const notbremse = new Promise<Response>((resolve) => {
    zeitgeber = setTimeout(() => {
      try { zustand.client?.close(); } catch { /* schon zu */ }
      resolve(antwort({ fehler: `Zeitüberschreitung (${NOTBREMSE_MS / 1000} s) bei: ${zustand.schritt}` }, 504));
    }, NOTBREMSE_MS);
  });
  try {
    return await Promise.race([verarbeiten(req, zustand), notbremse]);
  } finally {
    clearTimeout(zeitgeber);
  }
});
