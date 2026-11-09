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

export { buchhaltungsMandant, belegOrdner, belegDateiname };
