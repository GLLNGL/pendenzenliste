// Zahlungslauf (v7): Zahlungsdatei pain.001 nach Swiss Payment Standards 2022
// (pain.001.001.09, Schweizer Ausprägung "ch.03") fuer den Upload ins E-Banking (z.B. UBS).
// Reine Funktionen mit Tests: Pruefungen (IBAN, QR-IBAN, QR-/RF-Referenz, Adresse) und XML.

const NUR_ZIFFERN = /^\d+$/;

function kompakt(text) {
  return String(text ?? '').replace(/\s+/g, '').toUpperCase();
}

// Modulo 97 ueber eine lange Ziffernfolge (IBAN, RF-Referenz).
function mod97(ziffern) {
  let rest = 0;
  for (const z of ziffern) rest = (rest * 10 + Number(z)) % 97;
  return rest;
}

function buchstabenZuZahlen(text) {
  return [...text].map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c)).join('');
}

function ibanGueltig(iban) {
  const i = kompakt(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(i)) return false;
  if ((i.startsWith('CH') || i.startsWith('LI')) && i.length !== 21) return false;
  return mod97(buchstabenZuZahlen(i.slice(4) + i.slice(0, 4))) === 1;
}

// QR-IBAN: Schweizer/Liechtensteiner IBAN mit Instituts-ID 30000–31999.
function istQrIban(iban) {
  const i = kompakt(iban);
  if (!(i.startsWith('CH') || i.startsWith('LI'))) return false;
  const iid = Number(i.slice(4, 9));
  return iid >= 30000 && iid <= 31999;
}

// QR-Referenz: 27 Ziffern, letzte = Pruefziffer nach Modulo 10 rekursiv.
function qrReferenzGueltig(ref) {
  const r = kompakt(ref);
  if (r.length !== 27 || !NUR_ZIFFERN.test(r)) return false;
  const tabelle = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];
  let uebertrag = 0;
  for (const z of r.slice(0, 26)) uebertrag = tabelle[(uebertrag + Number(z)) % 10];
  return (10 - uebertrag) % 10 === Number(r[26]);
}

// Creditor Reference (ISO 11649): RF + 2 Pruefziffern + bis 21 Zeichen.
function scorGueltig(ref) {
  const r = kompakt(ref);
  if (!/^RF\d{2}[A-Z0-9]{1,21}$/.test(r)) return false;
  return mod97(buchstabenZuZahlen(r.slice(4) + r.slice(0, 4))) === 1;
}

// Adresse "Strasse Nr, PLZ Ort[, Land]" -> strukturierte Adresse. Land: CH, wenn nicht genannt.
const LAENDER = { schweiz: 'CH', suisse: 'CH', svizzera: 'CH', switzerland: 'CH', liechtenstein: 'LI', deutschland: 'DE', germany: 'DE', österreich: 'AT', oesterreich: 'AT', austria: 'AT', frankreich: 'FR', france: 'FR', italien: 'IT', italia: 'IT' };
function adresseZerlegen(text) {
  const teile = String(text ?? '').split(/[,\n]+/).map((t) => t.trim()).filter(Boolean);
  if (!teile.length) return null;
  let land = 'CH';
  const letzter = teile[teile.length - 1].toLowerCase();
  if (LAENDER[letzter] || /^[A-Z]{2}$/.test(teile[teile.length - 1])) {
    land = LAENDER[letzter] ?? teile[teile.length - 1];
    teile.pop();
  }
  const ortTeil = teile.pop();
  const ortTreffer = /^(?:([A-Z]{1,2})[-\s])?(\d{4,5})\s+(.+)$/.exec(ortTeil ?? '');
  if (!ortTreffer) return null;
  if (ortTreffer[1] && !LAENDER[ortTreffer[1].toLowerCase()]) land = ortTreffer[1] === 'D' ? 'DE' : ortTreffer[1] === 'A' ? 'AT' : land;
  const adresse = { pstCd: ortTreffer[2], twnNm: ortTreffer[3].trim(), ctry: land };
  const strasse = teile.join(', ');
  if (strasse) {
    const s = /^(.*?)\s+(\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)?)$/.exec(strasse);
    if (s) { adresse.strtNm = s[1]; adresse.bldgNb = s[2]; } else adresse.strtNm = strasse;
  }
  return adresse;
}

// Art der Referenz zu einer Zahlung: QR-IBAN verlangt QRR, sonst SCOR oder freie Mitteilung.
function referenzArt(iban, referenz) {
  const r = kompakt(referenz);
  if (istQrIban(iban)) return qrReferenzGueltig(r) ? { typ: 'QRR', ref: r } : { typ: 'QRR', fehler: 'QR-IBAN braucht eine gültige QR-Referenz (27 Ziffern)' };
  if (r.startsWith('RF')) return scorGueltig(r) ? { typ: 'SCOR', ref: r } : { typ: 'SCOR', fehler: 'RF-Referenz ungültig' };
  if (NUR_ZIFFERN.test(r) && r.length === 27) return { typ: 'NON', fehler: 'QR-Referenz nur mit QR-IBAN zulässig' };
  return { typ: 'NON', mitteilung: String(referenz ?? '').trim() };
}

// Fehler, die eine Zahlung verhindern (leere Liste = in Ordnung).
function zahlungPruefen(b) {
  const fehler = [];
  const iban = kompakt(b.iban);
  if (!iban) fehler.push('IBAN fehlt');
  else if (!ibanGueltig(iban)) fehler.push('IBAN ungültig');
  else if (!['CH', 'LI'].includes(iban.slice(0, 2))) fehler.push('Auslandzahlung – bitte im E-Banking von Hand erfassen');
  if (!(Number(b.betrag) > 0)) fehler.push('Betrag fehlt');
  if (!['CHF', 'EUR'].includes((b.waehrung || 'CHF').toUpperCase())) fehler.push('nur CHF oder EUR');
  // Die Adresse ist bei Inlandzahlungen freiwillig (nur Hinweis, siehe zahlungHinweise).
  if (iban && ibanGueltig(iban)) {
    const r = referenzArt(iban, b.zahlungsreferenz);
    if (r.fehler) fehler.push(r.fehler);
  }
  return fehler;
}

// Hinweise, die eine Zahlung nicht verhindern.
function zahlungHinweise(b) {
  return adresseZerlegen(b.partner_adresse) ? [] : ['ohne Adresse'];
}

function xml(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Zeichen ausserhalb des erlaubten Swiss-Payment-Zeichensatzes ersetzen.
function sauber(text, max) {
  return String(text ?? '').normalize('NFC').replace(/[^\x20-\x7E -ſ€]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function betragText(betrag) {
  return (Math.round(Number(betrag) * 100) / 100).toFixed(2);
}

function adresseXml(a) {
  return [
    '<PstlAdr>',
    a.strtNm ? `<StrtNm>${xml(sauber(a.strtNm, 70))}</StrtNm>` : '',
    a.bldgNb ? `<BldgNb>${xml(sauber(a.bldgNb, 16))}</BldgNb>` : '',
    `<PstCd>${xml(sauber(a.pstCd, 16))}</PstCd>`,
    `<TwnNm>${xml(sauber(a.twnNm, 35))}</TwnNm>`,
    `<Ctry>${xml(a.ctry)}</Ctry>`,
    '</PstlAdr>',
  ].join('');
}

/**
 * pain.001.001.09 (SPS 2022) erzeugen.
 * @param auftrag { msgId, erstelltAm (ISO mit Zeit), ausfuehrungsdatum, auftraggeber, iban, bic }
 * @param belege  Kreditorenbelege (partner, partner_adresse, iban, zahlungsreferenz, betrag, waehrung, rechnungsnummer, id)
 */
function pain001(auftrag, belege) {
  const proWaehrung = new Map();
  for (const b of belege) {
    const w = (b.waehrung || 'CHF').toUpperCase();
    if (!proWaehrung.has(w)) proWaehrung.set(w, []);
    proWaehrung.get(w).push(b);
  }
  const summe = (liste) => liste.reduce((s, b) => s + Math.round(Number(b.betrag) * 100), 0) / 100;
  const agent = auftrag.bic ? `<FinInstnId><BICFI>${xml(kompakt(auftrag.bic))}</BICFI></FinInstnId>` : '<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>';

  const bloecke = [...proWaehrung.entries()].map(([waehrung, liste], i) => {
    const transaktionen = liste.map((b) => {
      const iban = kompakt(b.iban);
      const r = referenzArt(iban, b.zahlungsreferenz);
      let rmt = '';
      if (r.typ === 'QRR') rmt = `<RmtInf><Strd><CdtrRefInf><Tp><CdOrPrtry><Prtry>QRR</Prtry></CdOrPrtry></Tp><Ref>${r.ref}</Ref></CdtrRefInf></Strd></RmtInf>`;
      else if (r.typ === 'SCOR') rmt = `<RmtInf><Strd><CdtrRefInf><Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp><Ref>${r.ref}</Ref></CdtrRefInf></Strd></RmtInf>`;
      else {
        const text = sauber(r.mitteilung || (b.rechnungsnummer ? `Rechnung ${b.rechnungsnummer}` : ''), 140);
        if (text) rmt = `<RmtInf><Ustrd>${xml(text)}</Ustrd></RmtInf>`;
      }
      const id = `BELEG-${b.id}`;
      return [
        '<CdtTrfTxInf>',
        `<PmtId><InstrId>${id}</InstrId><EndToEndId>${id}</EndToEndId></PmtId>`,
        `<Amt><InstdAmt Ccy="${waehrung}">${betragText(b.betrag)}</InstdAmt></Amt>`,
        `<Cdtr><Nm>${xml(sauber(b.partner, 70))}</Nm>${adresseZerlegen(b.partner_adresse) ? adresseXml(adresseZerlegen(b.partner_adresse)) : ''}</Cdtr>`,
        `<CdtrAcct><Id><IBAN>${iban}</IBAN></Id></CdtrAcct>`,
        rmt,
        '</CdtTrfTxInf>',
      ].join('');
    });
    return [
      '<PmtInf>',
      `<PmtInfId>${xml(`${auftrag.msgId}-${i + 1}`)}</PmtInfId>`,
      '<PmtMtd>TRF</PmtMtd><BtchBookg>true</BtchBookg>',
      `<NbOfTxs>${liste.length}</NbOfTxs><CtrlSum>${betragText(summe(liste))}</CtrlSum>`,
      `<ReqdExctnDt><Dt>${auftrag.ausfuehrungsdatum}</Dt></ReqdExctnDt>`,
      `<Dbtr><Nm>${xml(sauber(auftrag.auftraggeber, 70))}</Nm></Dbtr>`,
      `<DbtrAcct><Id><IBAN>${kompakt(auftrag.iban)}</IBAN></Id></DbtrAcct>`,
      `<DbtrAgt>${agent}</DbtrAgt>`,
      ...transaktionen,
      '</PmtInf>',
    ].join('');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09 pain.001.001.09.ch.03.xsd">',
    '<CstmrCdtTrfInitn>',
    '<GrpHdr>',
    `<MsgId>${xml(auftrag.msgId)}</MsgId>`,
    `<CreDtTm>${auftrag.erstelltAm}</CreDtTm>`,
    `<NbOfTxs>${belege.length}</NbOfTxs><CtrlSum>${betragText(summe(belege))}</CtrlSum>`,
    `<InitgPty><Nm>${xml(sauber(auftrag.auftraggeber, 70))}</Nm></InitgPty>`,
    '</GrpHdr>',
    ...bloecke,
    '</CstmrCdtTrfInitn>',
    '</Document>',
    '',
  ].join('\n');
}

export { ibanGueltig, istQrIban, qrReferenzGueltig, scorGueltig, adresseZerlegen, referenzArt, zahlungPruefen, zahlungHinweise, pain001, kompakt };
