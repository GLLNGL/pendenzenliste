// Monatskalender fuer die Cockpit-Seitenleiste (wie in Outlook): 6 Wochen ab Montag, dazu
// Outlook-Termine und an einem Tag geplante Pendenzen.

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const utc = (d) => { const [j, m, t] = d.split('-').map(Number); return Date.UTC(j, m - 1, t); };
const TAG = 86400000;

function plusTage(d, n) {
  return iso(utc(d) + n * TAG);
}

// Monat als 'YYYY-MM'; liefert 42 Tage (6 Wochen, Montag zuerst).
function monatsRaster(monat) {
  const erster = `${monat}-01`;
  const wochentag = (new Date(utc(erster)).getUTCDay() + 6) % 7; // Mo = 0
  const start = plusTage(erster, -wochentag);
  return Array.from({ length: 42 }, (_, i) => {
    const tag = plusTage(start, i);
    return { tag, nummer: Number(tag.slice(8, 10)), imMonat: tag.slice(0, 7) === monat };
  });
}

function monatVerschieben(monat, n) {
  const [j, m] = monat.split('-').map(Number);
  const d = new Date(Date.UTC(j, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const monatName = (monat) => `${MONATE[Number(monat.slice(5, 7)) - 1]} ${monat.slice(0, 4)}`;

// Tag, an dem eine Pendenz geplant ist: "Warten auf" am Nachfassdatum, sonst Bearbeitungstag.
const geplantAm = (p) => (p.status === 'Warten auf' ? p.wiedervorlage : p.bearbeitungstag) ?? null;

// Pendenzen eines Tages (Projekt-Koepfe mit Teilaufgaben nicht -- die Teilaufgaben erscheinen).
function pendenzenAm(offene, tag) {
  return offene
    .filter((p) => p.status !== 'Erledigt' && !(p.teilaufgaben_gesamt > 0) && geplantAm(p) === tag)
    .sort((a, b) => (a.mandant_name ?? '~').localeCompare(b.mandant_name ?? '~', 'de-CH') || a.id - b.id);
}

// Termine, die einen Tag beruehren (mehrtaegige an jedem Tag). Ganztaegige enden um 00:00 des Folgetags.
function termineAm(termine, tag) {
  const folgetag = plusTage(tag, 1);
  return termine
    .filter((t) => t.start.slice(0, 10) < folgetag && (t.ende > `${tag}T00:00:00` || t.start.slice(0, 10) === tag))
    .sort((a, b) => Number(b.ganztag) - Number(a.ganztag) || a.start.localeCompare(b.start));
}

// Markierungen fuer das Raster: Tage mit Terminen bzw. geplanten Pendenzen.
function tagesMarken(raster, termine, offene) {
  const marken = new Map();
  for (const { tag } of raster) {
    marken.set(tag, { termine: termineAm(termine, tag).length, pendenzen: pendenzenAm(offene, tag).length });
  }
  return marken;
}

function zeitText(t, tag) {
  if (t.ganztag) return 'ganztägig';
  const von = t.start.slice(0, 10) === tag ? t.start.slice(11, 16) : '';
  const bis = t.ende.slice(0, 10) === tag ? t.ende.slice(11, 16) : '';
  return von && bis ? `${von}–${bis}` : von ? `ab ${von}` : bis ? `bis ${bis}` : 'ganzer Tag';
}

export { monatsRaster, monatVerschieben, monatName, pendenzenAm, termineAm, tagesMarken, zeitText, geplantAm, plusTage };
