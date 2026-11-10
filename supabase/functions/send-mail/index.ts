// Ersetzt POST /api/mail/senden und /api/mail/test aus dem alten Express-Server
// (backend/src/mail.js) -- da der Browser kein rohes SMTP kann, laeuft der Versand hier in
// einer Supabase Edge Function (Deno) statt im eigenen Node-Prozess.
//
// Nutzt nodemailer (per npm:-Import, von Deno/Supabase unterstuetzt) -- dieselbe Bibliothek,
// die der alte Server schon erfolgreich fuer dieses Postfach verwendet hat. Ein erster Versuch
// mit der "denomailer"-Bibliothek scheiterte an einem bekannten STARTTLS-Bug dieser Bibliothek
// auf Port 587 ("invalid cmd" beim STARTTLS-Handshake, reproduzierbar und in anderen Projekten
// dokumentiert) -- nodemailer hat dieses Problem nicht.
//
// Braucht als Edge-Function-Secrets (Dashboard -> Edge Functions -> Secrets, KEIN Code hier):
//   SMTP_HOST, SMTP_PORT, SMTP_SECURE ("true"/"false"), SMTP_USER, SMTP_PASS, SMTP_FROM
// Werte stehen bereits lokal in backend/.env -- von dort abschreiben, nicht neu erfinden.
//
// Aufruf vom Frontend: supabase.functions.invoke('<echter-funktionsname>', { body: { an,
// betreff, text, icsBase64?, icsDateiname? } }). Erfordert eine angemeldete Person (Supabase
// prueft das JWT automatisch, bevor dieser Code ueberhaupt laeuft).

import nodemailer from 'npm:nodemailer@6.9.16';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  try {
    // anhaenge (v7, Offerten): [{ dateiname, base64, typ }] -- z.B. die Offerte als PDF.
    // html (v7): Mail in Arial 10 mit Signatur; cc/bcc: Listen von Adressen; anhaenge[].cid:
    // eingebettetes Bild (Logo der Signatur).
    const { an, cc, bcc, betreff, text, html, icsBase64, icsDateiname, anhaenge } = await req.json();
    if (!an || !text) {
      return new Response(JSON.stringify({ fehler: 'an und text sind erforderlich' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const secure = Deno.env.get('SMTP_SECURE') === 'true';
    const transporter = nodemailer.createTransport({
      host: Deno.env.get('SMTP_HOST') ?? '',
      port: Number(Deno.env.get('SMTP_PORT') ?? '587'),
      secure,
      requireTLS: !secure,
      auth: {
        user: Deno.env.get('SMTP_USER') ?? '',
        pass: Deno.env.get('SMTP_PASS') ?? '',
      },
    });

    await transporter.sendMail({
      from: Deno.env.get('SMTP_FROM') || Deno.env.get('SMTP_USER') || '',
      to: an,
      ...(Array.isArray(cc) && cc.length ? { cc } : {}),
      ...(Array.isArray(bcc) && bcc.length ? { bcc } : {}),
      subject: betreff || '(kein Betreff)',
      text,
      ...(html ? { html } : {}),
      attachments: [
        ...(icsBase64 ? [{ filename: icsDateiname || 'termin.ics', content: icsBase64, encoding: 'base64', contentType: 'text/calendar' }] : []),
        // Ohne HTML-Teil wird das eingebettete Logo nicht gebraucht.
        ...(Array.isArray(anhaenge) ? anhaenge.filter((a) => a?.base64 && (!a.cid || html)).map((a) => ({
          filename: a.dateiname || 'anhang.pdf', content: a.base64, encoding: 'base64', contentType: a.typ || 'application/pdf',
          ...(a.cid ? { cid: a.cid, contentDisposition: 'inline' } : {}),
        })) : []),
      ],
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ fehler: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
