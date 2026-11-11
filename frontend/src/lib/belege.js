// Buchhaltung (v7): Ablageort und Dateiname der Belege -- reine Funktionen mit Tests.
import { relativerOrdner, segmente } from './ablage.js';

// Mandant fuer die eigene Buchhaltung: aus den Einstellungen, sonst "EST Controlling ...".
function buchhaltungsMandant(einstellungen, mandanten) {
  const id = einstellungen?.mandantId;
  return (id && mandanten.find((m) => String(m.id) === String(id)))
    || mandanten.find((m) => /^est\s*controlling/i.test(m.name))
    || null;
}

// Ordner (relativ zum verbundenen OneDrive-Grundordner) fuer einen Beleg, z.B.
// ['…EST Controlling…', 'Kreditoren', '2026']. null = Mandant ohne Ablage-Ordner.
function belegOrdner({ art, datum }, einstellungen, mandant, grund) {
  const basis = relativerOrdner(mandant, grund);
  if (!basis?.length) return null;
  const unter = segmente(art === 'debitor' ? (einstellungen?.ordnerDebitoren ?? 'Debitoren') : (einstellungen?.ordnerKreditoren ?? 'Kreditoren'));
  const jahr = einstellungen?.proJahr === false ? [] : [String(datum || '').slice(0, 4) || String(new Date().getFullYear())];
  return [...basis, ...unter, ...jahr];
}

// Sprechender Dateiname: "2026-11-03 Swisscom AG 123456.pdf" (ohne verbotene Zeichen).
function belegDateiname({ rechnungsdatum, partner, rechnungsnummer }, original) {
  const punkt = String(original ?? '').lastIndexOf('.');
  const endung = punkt > 0 ? original.slice(punkt).toLowerCase() : '.pdf';
  const teile = [rechnungsdatum, partner, rechnungsnummer].filter(Boolean).map((t) => String(t).replace(/[<>:"/\\|?*\n\r\t]+/g, ' ').trim());
  const stamm = teile.join(' ').replace(/\s+/g, ' ').slice(0, 120).trim();
  return stamm ? `${stamm}${endung}` : String(original || `Beleg${endung}`);
}

// Debitorenrechnung per E-Mail: Standardtext (falls in den Einstellungen nichts hinterlegt ist).
const RECHNUNG_VORLAGE = {
  mailBetreff: 'Rechnung {nummer} – {firma}',
  mailText: [
    'Guten Tag {ansprechperson}',
    '',
    'Besten Dank für Ihren Auftrag. Im Anhang erhalten Sie unsere Rechnung {nummer} vom {datum} über {waehrung} {betrag}.',
    '',
    'Wir bitten Sie, den Betrag bis am {faelligkeit} zu überweisen. Für Fragen stehen wir Ihnen gerne zur Verfügung.',
  ].join('\n'),
};

// Firmenname ohne Rechtsform, Akzente und Satzzeichen (zum Vergleichen).
function vereinfacht(name) {
  return String(name ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(ag|gmbh|sa|sarl|klg|kg|ltd|inc)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Mandant zum Debitor (gleicher Name, Rechtsform egal) -- fuer E-Mail-Vorschlaege.
function mandantZuPartner(partner, mandanten) {
  const ziel = vereinfacht(partner);
  if (!ziel) return null;
  return mandanten.find((m) => vereinfacht(m.name) === ziel)
    ?? mandanten.find((m) => { const v = vereinfacht(m.name); return v && (v.startsWith(ziel) || ziel.startsWith(v)); })
    ?? null;
}

function datumCh(iso) {
  return iso ? iso.split('-').reverse().join('.') : '–';
}

// Platzhalter der Rechnungs-Mail.
function rechnungPlatzhalter(beleg, mandant, firma = {}) {
  const betrag = beleg.betrag == null ? '–' : Number(beleg.betrag).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return {
    nummer: beleg.rechnungsnummer || '', datum: datumCh(beleg.rechnungsdatum), faelligkeit: datumCh(beleg.faelligkeit),
    betrag, waehrung: beleg.waehrung || 'CHF', debitor: beleg.partner || '', mandant: beleg.partner || '',
    ansprechperson: mandant?.ansprechperson || '', firma: firma.firma || '',
  };
}

export { buchhaltungsMandant, belegOrdner, belegDateiname, RECHNUNG_VORLAGE, mandantZuPartner, rechnungPlatzhalter };
