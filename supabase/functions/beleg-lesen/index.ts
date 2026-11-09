// Buchhaltung (v7): liest eine Kreditoren- oder Debitorenrechnung (PDF oder Bild) mit Claude
// aus und gibt die Angaben fuer die Belegliste zurueck. Die Datei wird NICHT gespeichert -- sie
// geht nur fuer die Auswertung an die Claude-API; abgelegt wird sie von der App in OneDrive.
//
// Aufruf aus der App: supabase.functions.invoke('beleg-lesen', { body: { art, dateiname, typ,
// base64, firma } }) -- nur angemeldete Personen (Supabase prueft das JWT).
//
// Secret: ANTHROPIC_API_KEY (dasselbe wie fuer "mail-eingang").

import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const schluessel = (Deno.env.get('ANTHROPIC_API_KEY') ?? '').replace(/[^\x21-\x7E]/g, '').replace(/^["'«]+|["'»]+$/g, '');
const anthropic = schluessel ? new Anthropic({ apiKey: schluessel }) : null;

const SCHEMA = {
  type: 'object',
  properties: {
    partner: { type: 'string', description: 'Kreditor (Rechnungssteller) bzw. Debitor (Rechnungsempfänger), Firmenname' },
    rechnungsnummer: { type: ['string', 'null'] },
    rechnungsdatum: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    faelligkeit: { type: ['string', 'null'], description: 'YYYY-MM-DD; aus Zahlungsfrist berechnet, falls nur "30 Tage netto" o.ä. angegeben' },
    betrag: { type: ['number', 'null'], description: 'Total zu bezahlen inkl. MWST' },
    waehrung: { type: 'string', description: 'z.B. CHF oder EUR' },
    partner_adresse: { type: ['string', 'null'], description: 'Adresse des Partners in einer Zeile: "Strasse Nr, PLZ Ort" (Land nur ausserhalb der Schweiz)' },
    iban: { type: ['string', 'null'], description: 'IBAN bzw. QR-IBAN, auf die zu zahlen ist (Zahlteil "Konto / Zahlbar an"), ohne Leerzeichen' },
    referenz: { type: ['string', 'null'], description: 'QR-Referenz (27 Ziffern) oder RF-Referenz aus dem Zahlteil, ohne Leerzeichen; sonst eine kurze Zahlungsmitteilung' },
  },
  required: ['partner', 'rechnungsnummer', 'rechnungsdatum', 'faelligkeit', 'betrag', 'waehrung', 'partner_adresse', 'iban', 'referenz'],
  additionalProperties: false,
};

function antwort(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

const BILDTYPEN = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (!anthropic) return antwort({ fehler: 'ANTHROPIC_API_KEY fehlt in den Secrets der Edge Functions.' }, 500);
  try {
    const { art, dateiname, typ, base64, firma } = await req.json();
    if (!base64) return antwort({ fehler: 'Keine Datei erhalten.' }, 400);
    const istPdf = typ === 'application/pdf' || /\.pdf$/i.test(dateiname ?? '');
    if (!istPdf && !BILDTYPEN.includes(typ)) return antwort({ fehler: 'Nur PDF oder Bilder (PNG/JPG) können ausgelesen werden.' }, 400);

    const beleg = istPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image', source: { type: 'base64', media_type: typ, data: base64 } };
    const rolle = art === 'debitor'
      ? `Das ist eine Ausgangsrechnung (Debitor): ${firma || 'unser Büro'} hat sie gestellt. partner = der Rechnungsempfänger.`
      : `Das ist eine Eingangsrechnung (Kreditor): ${firma || 'unser Büro'} muss sie bezahlen. partner = der Rechnungssteller.`;
    const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' });

    const ki = await anthropic.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: 'Du liest Rechnungen für ein Schweizer Treuhandbüro aus. Gib nur Angaben zurück, die auf dem Beleg stehen oder sich eindeutig daraus ergeben (Fälligkeit = Rechnungsdatum + Zahlungsfrist). Unbekanntes = null. Daten als YYYY-MM-DD.',
      messages: [{
        role: 'user',
        content: [beleg, { type: 'text', text: `${rolle}\nHeute ist ${heute}. Dateiname: ${dateiname ?? ''}` }],
      }],
    // deno-lint-ignore no-explicit-any
    } as any, { timeout: 60000, maxRetries: 1 });

    if (ki.stop_reason === 'refusal' || ki.stop_reason === 'max_tokens') return antwort({ fehler: `Auslesen abgebrochen (${ki.stop_reason}).` }, 502);
    const block = ki.content.find((b: { type: string }) => b.type === 'text') as { text: string } | undefined;
    if (!block) return antwort({ fehler: 'Keine Antwort der KI erhalten.' }, 502);
    return antwort({ ok: true, angaben: JSON.parse(block.text) });
  } catch (err) {
    return antwort({ fehler: err instanceof Error ? err.message : String(err) }, 500);
  }
});
