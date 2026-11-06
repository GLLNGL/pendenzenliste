// Zeiterfassung (v7, Etappe 2) -- reine Logik ohne Datenbankzugriff.
import { preisProEinheit } from './preise.js';

const ZEIT_ARTEN = [
  { wert: 'pauschal', label: 'Pauschale', lang: 'In der Pauschale (nicht separat verrechnet)' },
  { wert: 'extra', label: 'Extra', lang: 'Extra-Arbeit (zum Stundenansatz verrechnet)' },
  { wert: 'intern', label: 'Intern', lang: 'Intern (eigenes Büro, ohne Mandant)' },
];

function artLabel(art) {
  return ZEIT_ARTEN.find((a) => a.wert === art)?.label ?? art;
}

// Laufzeit eines Timers in ganzen Minuten (angefangene Minute zaehlt, mindestens 1).
function laufendeMinuten(timerStart, jetzt = Date.now()) {
  const ms = jetzt - new Date(timerStart).getTime();
  return Math.max(1, Math.ceil(ms / 60000));
}

// "1:05" -- Stunden:Minuten.
function formatiereDauer(minuten) {
  if (minuten == null) return '–';
  const m = Math.round(Number(minuten));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

// Summen kompakt in Stunden: "12.5 h", "45 Min.".
function formatiereStundenSumme(minuten) {
  if (!minuten) return '0 h';
  if (minuten < 60) return `${minuten} Min.`;
  return `${(minuten / 60).toLocaleString('de-CH', { maximumFractionDigits: 2 })} h`;
}

// Eingabe der Dauer: "1:30" (h:mm), "1.5" / "1,5" (Stunden) oder "90" (Minuten).
// null bei ungueltiger Eingabe.
function parseDauer(text) {
  const t = String(text ?? '').trim().replace(/\s*(h|std\.?|min\.?)$/i, '');
  if (!t) return null;
  let minuten;
  if (/^\d+:\d{1,2}$/.test(t)) {
    const [h, m] = t.split(':').map(Number);
    if (m >= 60) return null;
    minuten = h * 60 + m;
  } else if (/^\d*[.,]\d+$/.test(t)) {
    minuten = Math.round(Number(t.replace(',', '.')) * 60);
  } else if (/^\d+$/.test(t)) {
    minuten = Number(t);
  } else {
    return null;
  }
  return minuten > 0 && minuten <= 1440 ? minuten : null;
}

// Leistungen, fuer die der Mandant heute eine Pauschale hat.
function pauschalLeistungIds(pauschalenDesMandanten) {
  return new Set(pauschalenDesMandanten.filter((p) => p.leistung_id).map((p) => p.leistung_id));
}

// Vorschlag Leistung: Standard-Leistung der Pendenz, sonst die einzige Pauschal-Leistung des
// Mandanten, sonst keine.
function leistungVorschlag(pendenz, pauschalenDesMandanten) {
  if (pendenz?.leistung_id) return pendenz.leistung_id;
  const ids = [...pauschalLeistungIds(pauschalenDesMandanten)];
  return ids.length === 1 ? ids[0] : null;
}

// Vorschlag Art: ohne Mandant intern; Leistung in einer Pauschale des Mandanten -> Pauschale,
// Leistung ohne Pauschale -> Extra; ohne Leistung -> Pauschale, sofern der Mandant ueberhaupt
// eine hat, sonst Extra.
function artVorschlag(mandantId, leistungId, pauschalenDesMandanten) {
  if (!mandantId) return 'intern';
  const ids = pauschalLeistungIds(pauschalenDesMandanten);
  if (leistungId) return ids.has(Number(leistungId)) ? 'pauschal' : 'extra';
  return pauschalenDesMandanten.length > 0 ? 'pauschal' : 'extra';
}

// Ansatz fuer Extra-Arbeit: (Ziel-)Ansatz der Leistung, sonst der Standardansatz.
function ansatzFuer(leistung, ansaetze) {
  if (leistung?.stundenansatz_id) {
    const a = ansaetze.find((x) => x.id === leistung.stundenansatz_id);
    if (a) return Number(a.chf_pro_stunde);
  }
  const standard = ansaetze.find((a) => a.ist_standard);
  return standard ? Number(standard.chf_pro_stunde) : null;
}

function betragExtra(eintrag) {
  if (eintrag.art !== 'extra' || eintrag.minuten == null || eintrag.stundenansatz_chf == null) return null;
  return (eintrag.minuten / 60) * Number(eintrag.stundenansatz_chf);
}

function zusammenfassung(eintraege) {
  const s = { gesamt: 0, pauschal: 0, extra: 0, intern: 0, extraBetrag: 0, laufend: 0 };
  for (const e of eintraege) {
    if (e.minuten == null) { s.laufend += 1; continue; }
    s.gesamt += e.minuten;
    s[e.art] += e.minuten;
    s.extraBetrag += betragExtra(e) ?? 0;
  }
  return s;
}

// Zeitraeume fuer das Zeitjournal (ISO-Daten, Woche ab Montag).
function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function zeitraum(art, heuteIso) {
  const [j, m, t] = heuteIso.split('-').map(Number);
  const heute = new Date(j, m - 1, t);
  const montag = new Date(heute);
  montag.setDate(heute.getDate() - ((heute.getDay() + 6) % 7));
  const plus = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  switch (art) {
    case 'woche': return { von: iso(montag), bis: iso(plus(montag, 6)) };
    case 'vorwoche': return { von: iso(plus(montag, -7)), bis: iso(plus(montag, -1)) };
    case 'monat': return { von: iso(new Date(j, m - 1, 1)), bis: iso(new Date(j, m, 0)) };
    case 'vormonat': return { von: iso(new Date(j, m - 2, 1)), bis: iso(new Date(j, m - 1, 0)) };
    case 'jahr': return { von: `${j}-01-01`, bis: `${j}-12-31` };
    default: return null;
  }
}

// Uhrzeit "HH:MM" (lokal) aus einem Zeitstempel bzw. Date.
function uhrzeitAus(zeit) {
  const d = new Date(zeit);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const UHRZEIT = /^\d{1,2}:\d{2}$/;

// Minuten zwischen zwei Uhrzeiten "09:00" und "10:15"; null, wenn ungueltig oder Ende <= Beginn.
function minutenZwischen(von, bis) {
  const m = (t) => (UHRZEIT.test(t || '') ? Number(t.split(':')[0]) * 60 + Number(t.split(':')[1]) : null);
  const a = m(von);
  const b = m(bis);
  if (a == null || b == null || b <= a) return null;
  return b - a;
}

// "HH:MM" plus Minuten -> "HH:MM" (fuer "bis" aus Beginn + Dauer).
function uhrzeitPlus(von, minuten) {
  if (!UHRZEIT.test(von || '') || minuten == null) return '';
  const gesamt = Number(von.split(':')[0]) * 60 + Number(von.split(':')[1]) + Number(minuten);
  if (gesamt >= 24 * 60) return '';
  return `${String(Math.floor(gesamt / 60)).padStart(2, '0')}:${String(gesamt % 60).padStart(2, '0')}`;
}

export {
  uhrzeitAus, minutenZwischen, uhrzeitPlus,
  ZEIT_ARTEN, artLabel, laufendeMinuten, formatiereDauer, formatiereStundenSumme, parseDauer,
  pauschalLeistungIds, leistungVorschlag, artVorschlag, ansatzFuer, betragExtra, zusammenfassung, zeitraum,
  preisProEinheit,
};
