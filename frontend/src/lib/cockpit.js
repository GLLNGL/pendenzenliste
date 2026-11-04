// Cockpit-Bereiche (Etappe 3) aus der Liste aller offenen, eingeplanten Pendenzen -- reine
// Funktion ohne Datenbank/React, damit sie sich mit `npm test` pruefen laesst.
import { plusArbeitstage } from './vorschlaege.js';

const PRIORITAET_RANG = { A: 0, B: 1, C: 2 };
const UNVERAENDERT_TAGE = 14;
const AUSLASTUNG_WARNSCHWELLE = 0.7;

function nachFristDannPrio(a, b) {
  if (a.faelligkeit !== b.faelligkeit) return a.faelligkeit < b.faelligkeit ? -1 : 1;
  return (PRIORITAET_RANG[a.prioritaet] ?? 9) - (PRIORITAET_RANG[b.prioritaet] ?? 9);
}

function plusTage(iso, tage) {
  const [j, m, t] = iso.split('-').map(Number);
  const datum = new Date(Date.UTC(j, m - 1, t + tage));
  return datum.toISOString().slice(0, 10);
}

// Montag bis Freitag der KOMMENDEN Woche (ab heute gesehen; an einem Sonntag ist das der
// morgige Montag).
function naechsteWoche(heuteISO) {
  const [j, m, t] = heuteISO.split('-').map(Number);
  const wochentag = new Date(Date.UTC(j, m - 1, t)).getUTCDay(); // 0 = Sonntag
  const bisMontag = ((8 - wochentag) % 7) || 7;
  const von = plusTage(heuteISO, bisMontag);
  return { von, bis: plusTage(von, 4) };
}

// Projekt-Koepfe (Hauptaufgaben mit Schritten) erscheinen nicht als eigene Arbeit -- es zaehlt
// jeweils der konkrete Schritt.
function istArbeitsschritt(p) {
  return !(p.teilaufgaben_gesamt > 0);
}

/**
 * @param {object[]} pendenzen  offene, eingeplante Pendenzen (aus pendenzen_angereichert)
 * @param {object} optionen
 *   heute        ISO-Datum (YYYY-MM-DD)
 *   jetzt        Date fuer "seit > 14 Tagen unveraendert"
 *   ichId        mitarbeitende.id der angemeldeten Person
 *   fokusstunden verfuegbare Fokusstunden pro Woche (Standard 15)
 *   block        optionaler Block-Filter (gilt fuer die Listen, nicht fuer die Auslastung)
 */
function berechneCockpit(pendenzen, { heute, jetzt, ichId, fokusstunden = 15, block = '' }) {
  const schritte = pendenzen.filter((p) => p.status !== 'Erledigt' && istArbeitsschritt(p));
  const gefiltert = block ? schritte.filter((p) => p.block === block) : schritte;

  // 1. Fällig heute und in den nächsten 5 Arbeitstagen (Überfälliges eingeschlossen).
  const grenze = plusArbeitstage(heute, 5);
  const faellig = gefiltert.filter((p) => p.faelligkeit <= grenze).sort(nachFristDannPrio);

  // 2. In Arbeit -- pro Person (WIP-Limit), rot ab 4.
  const inArbeit = gefiltert.filter((p) => p.status === 'In Arbeit' && p.bearbeiter_id === ichId).sort(nachFristDannPrio);
  const inArbeitAnzahl = schritte.filter((p) => p.status === 'In Arbeit' && p.bearbeiter_id === ichId).length;

  // 3. Warten auf mit überfälligem (bzw. heute fälligem) Nachfassdatum.
  const nachfassen = gefiltert
    .filter((p) => p.status === 'Warten auf' && p.wiedervorlage && p.wiedervorlage <= heute)
    .sort((a, b) => (a.wiedervorlage < b.wiedervorlage ? -1 : 1));

  // 4. Seit > 14 Tagen unverändert -- nur, woran gerade gearbeitet werden sollte (Offen/In
  // Arbeit). "Später" ist bewusst zurückgestellt, "Warten auf" läuft über Nachfassen.
  const stichtag = new Date(jetzt.getTime() - UNVERAENDERT_TAGE * 24 * 60 * 60 * 1000);
  const unveraendert = gefiltert
    .filter((p) => (p.status === 'Offen' || p.status === 'In Arbeit')
      && p.zuletzt_geaendert_am && new Date(p.zuletzt_geaendert_am) < stichtag)
    .sort((a, b) => (a.zuletzt_geaendert_am < b.zuletzt_geaendert_am ? -1 : 1));

  // Zusätzlich (bestehend): heute geplanter Bearbeitungstag.
  const heuteBearbeiten = gefiltert
    .filter((p) => p.bearbeitungstag && p.bearbeitungstag <= heute)
    .sort((a, b) => (a.bearbeitungstag < b.bearbeitungstag ? -1 : 1));

  // 5. Auslastung nächste Woche: Aufwand aller eigenen und noch nicht zugewiesenen Schritte,
  // die nächste Woche bearbeitet (Bearbeitungstag) bzw. fällig (Frist) sind. Ohne Block-Filter,
  // weil die Woche als Ganzes zählt.
  const woche = naechsteWoche(heute);
  const inWoche = schritte.filter((p) => {
    if (p.bearbeiter_id != null && p.bearbeiter_id !== ichId) return false;
    if (p.status === 'Warten auf') return false;
    const tag = p.bearbeitungstag || p.faelligkeit;
    return tag >= woche.von && tag <= woche.bis;
  });
  const minuten = inWoche.reduce((summe, p) => summe + (p.aufwand_minuten || 0), 0);
  const fokusMinuten = Number(fokusstunden) * 60;
  const anteil = fokusMinuten > 0 ? minuten / fokusMinuten : 0;

  return {
    faellig, inArbeit, inArbeitAnzahl, nachfassen, unveraendert, heuteBearbeiten,
    auslastung: {
      wocheVon: woche.von,
      wocheBis: woche.bis,
      minuten,
      fokusMinuten,
      anteil,
      warnung: anteil > AUSLASTUNG_WARNSCHWELLE,
      ohneAufwand: inWoche.filter((p) => p.aufwand_minuten == null).length,
      anzahl: inWoche.length,
    },
  };
}

export { berechneCockpit, naechsteWoche, AUSLASTUNG_WARNSCHWELLE, UNVERAENDERT_TAGE };
