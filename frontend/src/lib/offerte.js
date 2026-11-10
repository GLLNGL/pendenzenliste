// Offerten (v7) -- Rechenlogik wie im bisherigen Blatt "Angebot" des Excel-Preiskalkulators.
import { preisProEinheit } from './preise.js';

const OFFERT_STATUS = ['Entwurf', 'Versendet', 'Angenommen', 'Abgelehnt'];

function runden(z) {
  return Math.round(z * 100) / 100;
}

function positionAusLeistung(leistung, ansaetze, menge = '') {
  // Ohne Menge: Standardmenge der Leistung vorschlagen (z.B. 4 Quartalsabrechnungen pro Jahr).
  const vorschlag = menge === '' || menge == null ? (leistung.standard_menge != null ? String(Number(leistung.standard_menge)) : '') : menge;
  return {
    leistung_id: leistung.id, abacus_modul_id: null, bezeichnung: leistung.name, einheit: leistung.einheit,
    turnus: leistung.turnus, menge: vorschlag, preis_pro_einheit: runden(preisProEinheit(leistung, ansaetze) ?? 0),
    minuten_pro_einheit: leistung.minuten_pro_einheit ?? null, angebot_gruppe: leistung.angebot_gruppe ?? null, ist_lizenz: false,
  };
}

function positionAusModul(modul, menge = 1) {
  return {
    leistung_id: null, abacus_modul_id: modul.id, bezeichnung: modul.name, einheit: 'Mt.', turnus: 'monatlich',
    menge, preis_pro_einheit: Number(modul.chf_pro_monat), minuten_pro_einheit: null, angebot_gruppe: null, ist_lizenz: true,
  };
}

// CHF pro Monat einer Position (jaehrliche Leistungen auf 12 Monate verteilt).
function betragMonat(pos) {
  const z = Number(pos.menge || 0) * Number(pos.preis_pro_einheit || 0);
  return pos.turnus === 'jaehrlich' ? z / 12 : z;
}

// Zeilen fuer das Dokument: Leistungen derselben "Gruppe im Angebot" werden zu einer Zeile
// zusammengefasst (Menge/Einheit der ersten, ohne Einzelpreis, Summe als Gesamtpreis) --
// wie "Lohnbuchhaltung (inkl. Lohnausweise)" im Excel. Lizenzen folgen separat, Positionsnummern
// laufen durch.
function dokumentZeilen(positionen) {
  const leistungen = [];
  const gruppen = new Map();
  for (const p of positionen.filter((x) => !x.ist_lizenz)) {
    if (p.angebot_gruppe) {
      const g = gruppen.get(p.angebot_gruppe);
      if (g) { g.gPreis += betragMonat(p); continue; }
      const zeile = { bezeichnung: p.angebot_gruppe, menge: p.menge, einheit: p.einheit, ePreis: null, gPreis: betragMonat(p) };
      gruppen.set(p.angebot_gruppe, zeile);
      leistungen.push(zeile);
    } else {
      leistungen.push({ bezeichnung: p.bezeichnung, menge: p.menge, einheit: p.einheit, ePreis: Number(p.preis_pro_einheit), gPreis: betragMonat(p) });
    }
  }
  const lizenzen = positionen.filter((x) => x.ist_lizenz).map((p) => ({
    bezeichnung: p.bezeichnung, menge: p.menge, einheit: p.einheit, ePreis: Number(p.preis_pro_einheit), gPreis: betragMonat(p),
  }));
  let nr = 0;
  for (const z of [...leistungen, ...lizenzen]) z.pos = ++nr;
  return { leistungen, lizenzen };
}

function totale(positionen, offerte) {
  const netto = positionen.reduce((s, p) => s + betragMonat(p), 0);
  const rabatt = netto * (Number(offerte.rabatt_prozent || 0) / 100);
  const nettoNachRabatt = netto - rabatt;
  const mwst = offerte.mwst_pflichtig ? nettoNachRabatt * (Number(offerte.mwst_satz ?? 8.1) / 100) : 0;
  return { netto, rabatt, nettoNachRabatt, mwst, total: nettoNachRabatt + mwst, jahr: nettoNachRabatt * 12 };
}

// Planzeit pro Monat (nur Leistungen mit Zeit pro Einheit) und daraus der Satz pro Planstunde
// nach Rabatt -- zeigt schon beim Offerieren, ob der Preis die Zeit deckt.
function planung(positionen, offerte) {
  const faktor = 1 - Number(offerte.rabatt_prozent || 0) / 100;
  let minuten = 0;
  let ertrag = 0;
  let ohneZeit = 0;
  for (const p of positionen.filter((x) => !x.ist_lizenz)) {
    if (p.minuten_pro_einheit == null || p.minuten_pro_einheit === '') { ohneZeit += 1; continue; }
    const m = Number(p.menge || 0) * Number(p.minuten_pro_einheit);
    minuten += p.turnus === 'jaehrlich' ? m / 12 : m;
    ertrag += betragMonat(p) * faktor;
  }
  return { minuten, satz: minuten > 0 ? ertrag / (minuten / 60) : null, ohneZeit };
}

function naechsteNummer(offerten, jahr) {
  const praefix = `A-${jahr}-`;
  const hoechste = offerten.reduce((max, o) => {
    if (!o.nummer?.startsWith(praefix)) return max;
    const n = Number(o.nummer.slice(praefix.length));
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);
  return `${praefix}${String(hoechste + 1).padStart(2, '0')}`;
}

// Pauschalen, die bei Annahme entstehen: eine pro Katalog-Position, Betrag nach Rabatt.
function pauschalenAusOfferte(offerte, positionen) {
  const faktor = 1 - Number(offerte.rabatt_prozent || 0) / 100;
  return positionen
    .filter((p) => p.leistung_id || p.abacus_modul_id)
    .map((p) => ({
      leistung_id: p.ist_lizenz ? null : p.leistung_id,
      abacus_modul_id: p.ist_lizenz ? p.abacus_modul_id : null,
      menge: p.menge === '' ? null : Number(p.menge),
      betrag_monat: runden(betragMonat(p) * faktor),
    }));
}

// Platzhalter {name} in Mail-/Konditionen-Texten ersetzen.
function textErsetzen(vorlage, werte) {
  return String(vorlage ?? '').replace(/\{(\w+)\}/g, (_, k) => (werte[k] ?? ''));
}

// "CHF 1'234.50" -- Schweizer Format mit Apostroph wie im Excel.
function chf(betrag) {
  const s = Number(betrag || 0).toFixed(2);
  const [ganz, rappen] = s.replace('-', '').split('.');
  return `${Number(betrag) < 0 ? '-' : ''}CHF ${ganz.replace(/\B(?=(\d{3})+(?!\d))/g, "'")}.${rappen}`;
}

export {
  OFFERT_STATUS, positionAusLeistung, positionAusModul, betragMonat, dokumentZeilen, totale, planung,
  naechsteNummer, pauschalenAusOfferte, textErsetzen, chf, runden,
};
