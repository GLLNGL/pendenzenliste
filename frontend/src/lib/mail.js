// Ausgehende E-Mails (v7): einheitlich in Arial 10 pt mit Signatur und Logo, dazu CC/BCC.
// Reine Funktionen mit Tests; der Versand selbst laeuft ueber api.js -> Edge Function send-mail.

const STANDARD_SIGNATUR = [
  'Freundliche Grüsse',
  '',
  'Angelo Gallo',
  'Geschäftsführer',
  'CFO-Beratung | Controlling',
  '',
  'EST Controlling GmbH',
  'Hardstrasse 73',
  'CH-5430 Wettingen',
  'Telefon +41 56 426 73 73',
  'Mobile  +41 79 171 30 00',
  'info@estcontrolling.ch',
  'http://www.estcontrolling.ch/',
].join('\n');

const LOGO_CID = 'est-logo@auftragsmanagement';

// Schlussgruss am Ende des Textes entfernen ("Freundliche Grüsse" + Name/Firma) -- die Signatur
// bringt ihn mit. Nur die letzten Zeilen werden betrachtet.
function grussEntfernen(text) {
  const zeilen = String(text ?? '').replace(/\r/g, '').split('\n');
  const start = Math.max(0, zeilen.length - 8);
  for (let i = zeilen.length - 1; i >= start; i -= 1) {
    if (/^\s*(freundliche|beste|herzliche|liebe)\s+gr(ü|ue)sse\b/i.test(zeilen[i])) {
      return zeilen.slice(0, i).join('\n').replace(/\s+$/, '');
    }
  }
  return String(text ?? '').replace(/\s+$/, '');
}

function escapeHtml(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Links (E-Mail, Web) in einer bereits escapten Zeile anklickbar machen.
function verlinken(zeile) {
  return zeile
    .replace(/\b([\w.+-]+@[\w-]+\.[\w.-]+)\b/g, '<a href="mailto:$1" style="color:#0563C1">$1</a>')
    .replace(/\b(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#0563C1">$1</a>');
}

function zeilenHtml(text) {
  return escapeHtml(text).split('\n').map((z) => verlinken(z) || '&nbsp;').join('<br>\n');
}

// Text + Signatur -> { text, html }. mitLogo: Logo als eingebettetes Bild (cid) unter der Signatur.
function mailAufbereiten(text, signatur = STANDARD_SIGNATUR, { mitLogo = true } = {}) {
  const inhalt = grussEntfernen(text);
  const sig = String(signatur ?? '').trim();
  const nurText = sig ? `${inhalt}\n\n${sig}` : inhalt;
  const stil = 'font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#000000;line-height:1.35';
  const html = [
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head>',
    `<body style="${stil}">`,
    `<div style="${stil}">${zeilenHtml(inhalt)}</div>`,
    sig ? `<br><div style="${stil}">${zeilenHtml(sig)}</div>` : '',
    sig && mitLogo ? `<br><img src="cid:${LOGO_CID}" alt="EST Controlling" width="180" style="display:block;border:0;width:180px;height:auto">` : '',
    '</body></html>',
  ].join('\n');
  return { text: nurText, html };
}

// "a@b.ch; c@d.ch, e@f.ch" -> ['a@b.ch', 'c@d.ch', 'e@f.ch']; wirft bei ungueltigen Adressen.
function adressenListe(eingabe) {
  const liste = String(eingabe ?? '').split(/[;,\s]+/).map((a) => a.trim()).filter(Boolean);
  const falsch = liste.filter((a) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a));
  if (falsch.length) throw new Error(`Ungültige E-Mail-Adresse: ${falsch.join(', ')}`);
  return liste;
}

export { STANDARD_SIGNATUR, LOGO_CID, grussEntfernen, mailAufbereiten, adressenListe };
