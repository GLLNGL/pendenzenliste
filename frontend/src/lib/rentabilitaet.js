// Zeit & Verrechnung (v7, Etappe 4): erfasste Pauschal-Zeit gegen die offerierte Planzeit,
// Pauschalertrag und effektiver Stundensatz pro Mandant und Leistung; dazu die noch nicht
// verrechnete Extra-Zeit. Reine Funktionen mit Tests.
import { planMinutenMonat, zielansatz } from './preise.js';
import { betragExtra } from './zeit.js';

const TAGE_PRO_MONAT = 365.25 / 12;

function datum(iso) {
  const [j, m, t] = String(iso).slice(0, 10).split('-').map(Number);
  return Date.UTC(j, m - 1, t);
}
const tageZwischen = (a, b) => Math.round((datum(b) - datum(a)) / 86400000) + 1; // inklusiv

/**
 * Zeitraum: art 'monat' | 'quartal' | 'jahr', jahr, nr (Monat 1-12 bzw. Quartal 1-4).
 * Laeuft der Zeitraum noch, wird fuer die Planzeit nur bis heute gerechnet (bisPlan).
 */
function zeitraumVon({ art, jahr, nr }, heuteIso) {
  const pad = (x) => String(x).padStart(2, '0');
  const letzter = (j, m) => new Date(Date.UTC(j, m, 0)).getUTCDate();
  let von;
  let bis;
  if (art === 'monat') { von = `${jahr}-${pad(nr)}-01`; bis = `${jahr}-${pad(nr)}-${letzter(jahr, nr)}`; }
  else if (art === 'quartal') { const m1 = (nr - 1) * 3 + 1; von = `${jahr}-${pad(m1)}-01`; bis = `${jahr}-${pad(m1 + 2)}-${letzter(jahr, m1 + 2)}`; }
  else { von = `${jahr}-01-01`; bis = `${jahr}-12-31`; }
  const bisPlan = heuteIso && heuteIso >= von && heuteIso < bis ? heuteIso : bis;
  return { von, bis, bisPlan, laufend: bisPlan !== bis };
}

// Ueberlappung einer Pauschale mit dem Zeitraum in Monaten (tagesgenau).
function monateUeberlappung(p, von, bis) {
  const a = p.gueltig_ab > von ? p.gueltig_ab : von;
  const b = p.gueltig_bis && p.gueltig_bis < bis ? p.gueltig_bis : bis;
  if (a > b) return 0;
  return tageZwischen(a, b) / TAGE_PRO_MONAT;
}

// Ampel Auslastung (Ist / Plan): bis 90 % gruen, bis 110 % gelb, darueber rot.
function ampel(anteil) {
  if (anteil == null) return null;
  if (anteil <= 0.9) return 'gruen';
  if (anteil <= 1.1) return 'gelb';
  return 'rot';
}

/**
 * Auswertung pro Mandant (und darin pro Leistung).
 * @param eintraege Zeiteintraege im Zeitraum (mit art, minuten, mandant_id, leistung_id, rapport_id, stundenansatz_chf)
 * @param pauschalen alle mandant_pauschalen
 * @param leistungen Leistungskatalog, ansaetze Stundenansaetze
 * @param offeneExtra noch nicht verrechnete Extra-Eintraege (alle Zeitraeume)
 */
function auswerten({ eintraege, pauschalen, leistungen, ansaetze, offeneExtra = [], zeitraum, mandanten = [] }) {
  const { von, bisPlan } = zeitraum;
  const leistungNach = new Map(leistungen.map((l) => [l.id, l]));
  const mandantNach = new Map(mandanten.map((m) => [m.id, m]));
  const ergebnis = new Map();
  const mandant = (id) => {
    if (!ergebnis.has(id)) {
      ergebnis.set(id, {
        mandantId: id, name: mandantNach.get(id)?.name ?? '–', planMinuten: 0, istMinuten: 0, ertrag: 0,
        extraMinuten: 0, extraBetrag: 0, offenMinuten: 0, offenBetrag: 0, offenVon: null, offenBis: null, leistungen: new Map(),
      });
    }
    return ergebnis.get(id);
  };
  const zeile = (m, leistungId) => {
    const key = leistungId ?? 0;
    if (!m.leistungen.has(key)) {
      const l = leistungNach.get(leistungId);
      m.leistungen.set(key, { leistungId, name: l?.name ?? 'ohne Leistung', planMinuten: 0, istMinuten: 0, ertrag: 0, zielsatz: l ? zielansatz(l, ansaetze) : null });
    }
    return m.leistungen.get(key);
  };

  // Plan und Ertrag aus den Pauschalen (nur Leistungen; ABACUS-Lizenzen zaehlen nicht zur Zeit).
  for (const p of pauschalen) {
    if (!p.leistung_id) continue;
    const monate = monateUeberlappung(p, von, bisPlan);
    if (monate <= 0) continue;
    const m = mandant(p.mandant_id);
    const z = zeile(m, p.leistung_id);
    const plan = (planMinutenMonat(leistungNach.get(p.leistung_id), p.menge) ?? 0) * monate;
    const ertrag = Number(p.betrag_monat || 0) * monate;
    z.planMinuten += plan; z.ertrag += ertrag;
    m.planMinuten += plan; m.ertrag += ertrag;
  }
  // Erfasste Zeit.
  for (const e of eintraege) {
    if (!e.mandant_id || e.minuten == null) continue;
    const m = mandant(e.mandant_id);
    if (e.art === 'extra') {
      m.extraMinuten += e.minuten;
      m.extraBetrag += betragExtra(e) ?? 0;
    } else if (e.art === 'pauschal') {
      m.istMinuten += e.minuten;
      zeile(m, e.leistung_id ?? null).istMinuten += e.minuten;
    }
  }
  // Offene Extra-Zeit (unabhaengig vom Zeitraum).
  for (const e of offeneExtra) {
    if (!e.mandant_id || e.minuten == null || e.art !== 'extra' || e.rapport_id) continue;
    const m = mandant(e.mandant_id);
    m.offenMinuten += e.minuten;
    m.offenBetrag += betragExtra(e) ?? 0;
    if (!m.offenVon || e.datum < m.offenVon) m.offenVon = e.datum;
    if (!m.offenBis || e.datum > m.offenBis) m.offenBis = e.datum;
  }

  const runden = (x) => Math.round(x * 100) / 100;
  return [...ergebnis.values()].map((m) => {
    const zeilen = [...m.leistungen.values()].map((z) => ({
      ...z,
      planMinuten: Math.round(z.planMinuten),
      ertrag: runden(z.ertrag),
      anteil: z.planMinuten > 0 ? z.istMinuten / z.planMinuten : null,
      satz: z.istMinuten > 0 && z.ertrag > 0 ? runden(z.ertrag / (z.istMinuten / 60)) : null,
    })).map((z) => ({ ...z, ampel: ampel(z.anteil) }))
      .sort((a, b) => b.planMinuten - a.planMinuten || b.istMinuten - a.istMinuten);
    const anteil = m.planMinuten > 0 ? m.istMinuten / m.planMinuten : null;
    return {
      ...m,
      leistungen: zeilen,
      planMinuten: Math.round(m.planMinuten),
      ertrag: runden(m.ertrag),
      extraBetrag: runden(m.extraBetrag),
      offenBetrag: runden(m.offenBetrag),
      anteil,
      ampel: ampel(anteil),
      satz: m.istMinuten > 0 && m.ertrag > 0 ? runden(m.ertrag / (m.istMinuten / 60)) : null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'de-CH'));
}

// Totale ueber alle Mandanten.
function totale(zeilen) {
  const t = zeilen.reduce((s, m) => ({
    planMinuten: s.planMinuten + m.planMinuten, istMinuten: s.istMinuten + m.istMinuten, ertrag: s.ertrag + m.ertrag,
    extraMinuten: s.extraMinuten + m.extraMinuten, extraBetrag: s.extraBetrag + m.extraBetrag,
    offenMinuten: s.offenMinuten + m.offenMinuten, offenBetrag: s.offenBetrag + m.offenBetrag,
  }), { planMinuten: 0, istMinuten: 0, ertrag: 0, extraMinuten: 0, extraBetrag: 0, offenMinuten: 0, offenBetrag: 0 });
  t.anteil = t.planMinuten > 0 ? t.istMinuten / t.planMinuten : null;
  t.satz = t.istMinuten > 0 && t.ertrag > 0 ? Math.round((t.ertrag / (t.istMinuten / 60)) * 100) / 100 : null;
  return t;
}

export { zeitraumVon, monateUeberlappung, ampel, auswerten, totale };
