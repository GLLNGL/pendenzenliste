// Vorschläge beim Erfassen (Etappe 2) -- reine Funktionen ohne Datenbank/React, damit sie sich
// mit `npm test` prüfen lassen.

// Gleiche Stichwörter wie die einmalige Block-Migration in supabase/schema.sql (Reihenfolge
// zählt: der erste Treffer gewinnt, z.B. "MWST-Abstimmung" vor "Abstimmung" im Abschluss).
const BLOCK_STICHWOERTER = [
  ['MWST', /(mwst|mehrwertsteuer)/i],
  ['Lohn', /(lohn|löhne|salär|ahv|bvg|suva|sva|qst|quellensteuer|kizu|sozialversicherung|gastrosocial|bonus|mitarbeitende anmelden)/i],
  ['Zahlungen', /(zahlung|zahllauf|kreditor|ebics)/i],
  ['Debitoren', /(mahn|debitor|inkasso|betreibung|rechnung versenden|faktur)/i],
  ['Abschluss', /(abschluss|jahresrechnung|bilanz|reporting|steuererkl|steuerveranlag|steuerauflag)/i],
  ['Admin', /(ordnerstruktur|offerte|angebot|ablage|admin)/i],
];

function blockVorschlag(titel) {
  if (!titel) return null;
  const treffer = BLOCK_STICHWOERTER.find(([, muster]) => muster.test(titel));
  return treffer ? treffer[0] : null;
}

function alsUTCDatum(iso) {
  const [jahr, monat, tag] = iso.split('-').map(Number);
  return new Date(Date.UTC(jahr, monat - 1, tag));
}

function alsISO(datum) {
  return datum.toISOString().slice(0, 10);
}

function istArbeitstag(datum) {
  const wochentag = datum.getUTCDay();
  return wochentag !== 0 && wochentag !== 6;
}

// Datum, das `anzahl` Arbeitstage (Mo–Fr, ohne Feiertage) nach `vonISO` liegt.
function plusArbeitstage(vonISO, anzahl) {
  const datum = alsUTCDatum(vonISO);
  let rest = anzahl;
  while (rest > 0) {
    datum.setUTCDate(datum.getUTCDate() + 1);
    if (istArbeitstag(datum)) rest -= 1;
  }
  return alsISO(datum);
}

// Datum, das `anzahl` Arbeitstage VOR `bisISO` liegt (für Vorläufe wie "2 Arbeitstage vorher").
function minusArbeitstage(bisISO, anzahl) {
  const datum = alsUTCDatum(bisISO);
  let rest = anzahl;
  while (rest > 0) {
    datum.setUTCDate(datum.getUTCDate() - 1);
    if (istArbeitstag(datum)) rest -= 1;
  }
  return alsISO(datum);
}

// Priorität A = harte Frist in höchstens 5 Arbeitstagen (bereits überfällige eingeschlossen).
// "Mandant blockiert" lässt sich nicht automatisch erkennen -- das bleibt eine bewusste Wahl.
function prioritaetVorschlag({ faelligkeit, harteFrist }, heuteISO) {
  if (!harteFrist || !faelligkeit) return null;
  return faelligkeit <= plusArbeitstage(heuteISO, 5) ? 'A' : null;
}

export { blockVorschlag, plusArbeitstage, minusArbeitstage, prioritaetVorschlag };
