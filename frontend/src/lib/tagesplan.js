// Tagesplan fuers Cockpit (v7): nur Heute, Morgen und Wochenziele -- damit sichtbar ist, ob alles
// erledigt ist. Dazu der Ordner "Zu planen": alle offenen Pendenzen ohne Bearbeitungstag.
// Reine Funktionen ohne Datenbank, mit Tests.
import { plusArbeitstage } from './vorschlaege.js';
import { montagDerWoche } from './wochenrueckblick.js';

const PRIO = { A: 0, B: 1, C: 2 };

function sortierung(a, b) {
  return (PRIO[a.prioritaet] ?? 9) - (PRIO[b.prioritaet] ?? 9)
    || String(a.faelligkeit ?? '9999').localeCompare(String(b.faelligkeit ?? '9999'))
    || a.titel.localeCompare(b.titel, 'de-CH');
}

// Projekt-Koepfe sind keine eigene Arbeit -- es zaehlen die Teilaufgaben.
function istArbeit(p) {
  return !(p.teilaufgaben_gesamt > 0) && p.geplant !== false;
}

// Eigene und noch niemandem zugewiesene Pendenzen.
function meine(p, ichId) {
  return ichId == null || p.bearbeiter_id == null || p.bearbeiter_id === ichId;
}

// Gehoert eine offene Pendenz auf den Tag? Ein geplanter Bearbeitungstag hat Vorrang (wer etwas
// auf Montag legt, sieht es erst Montag -- auch wenn es "In Arbeit" oder faellig ist). Ohne
// Bearbeitungstag: "In Arbeit" und Frist heute. "Warten auf" erscheint am Nachfassdatum.
// Vergangenes (Frist, Bearbeitungstag, Nachfassdatum vor heute) steht in der Spalte
// "Abgelaufen" (siehe abgelaufene()) -- nicht zusaetzlich hier.
function istHeute(p, heute) {
  if (p.status === 'Warten auf') return p.wiedervorlage === heute || (!p.wiedervorlage && !p.bearbeitungstag && p.faelligkeit === heute);
  if (p.bearbeitungstag) return p.bearbeitungstag === heute || (p.status === 'In Arbeit' && p.bearbeitungstag < heute);
  return p.status === 'In Arbeit' || p.faelligkeit === heute;
}

/**
 * @param offene     offene, eingeplante Pendenzen
 * @param erledigte  in dieser Woche erledigte Pendenzen
 * @param optionen   { heute, ichId }
 */
function tagesplan(offene, erledigte, { heute, ichId = null }) {
  const offen = offene.filter((p) => p.status !== 'Erledigt' && istArbeit(p) && meine(p, ichId));
  const fertig = erledigte.filter((p) => p.status === 'Erledigt' && istArbeit(p) && meine(p, ichId));
  const morgenTag = plusArbeitstage(heute, 1);
  const montag = montagDerWoche(heute);

  // Ist ein Projekt selbst geplant/faellig, gehoert seine aktive Teilaufgabe (Offen/In Arbeit) dazu.
  const koepfe = offene.filter((p) => p.teilaufgaben_gesamt > 0 && p.status !== 'Erledigt' && meine(p, ichId));
  const kopfHeute = new Set(koepfe.filter((k) => istHeute(k, heute)).map((k) => k.id));
  const kopfMorgen = new Set(koepfe.filter((k) => !kopfHeute.has(k.id) && (k.bearbeitungstag === morgenTag || k.faelligkeit === morgenTag)).map((k) => k.id));
  const aktiverSchritt = (p, ids) => !p.bearbeitungstag && ids.has(p.uebergeordnete_pendenz_id) && ['Offen', 'In Arbeit'].includes(p.status);

  const heuteOffen = offen.filter((p) => istHeute(p, heute) || aktiverSchritt(p, kopfHeute)).sort(sortierung);
  const heuteIds = new Set(heuteOffen.map((p) => p.id));
  const morgenOffen = offen
    .filter((p) => !heuteIds.has(p.id) && (p.bearbeitungstag === morgenTag || (!p.bearbeitungstag && p.faelligkeit === morgenTag)
      || (p.status === 'Warten auf' && p.wiedervorlage === morgenTag) || aktiverSchritt(p, kopfMorgen)))
    .sort(sortierung);

  return {
    heute: { tag: heute, offen: heuteOffen, erledigt: fertig.filter((p) => p.erledigt_am === heute).sort(sortierung) },
    morgen: { tag: morgenTag, offen: morgenOffen },
    wochenziele: {
      woche: montag,
      offen: offen.filter((p) => p.wochenziel_woche === montag).sort(sortierung),
      erledigt: fertig.filter((p) => p.wochenziel_woche === montag).sort(sortierung),
    },
  };
}

// Warum eine offene Pendenz abgelaufen ist (aeltestes Datum zuerst geprueft) -- oder null.
//   { art: 'frist' | 'geplant' | 'nachfassen', datum }
function abgelaufenGrund(p, heute) {
  if (p.faelligkeit && p.faelligkeit < heute) return { art: 'frist', datum: p.faelligkeit };
  if (p.status === 'Warten auf' && p.wiedervorlage && p.wiedervorlage < heute) return { art: 'nachfassen', datum: p.wiedervorlage };
  if (p.status !== 'Warten auf' && p.bearbeitungstag && p.bearbeitungstag < heute) return { art: 'geplant', datum: p.bearbeitungstag };
  return null;
}

// Abgelaufene Aufgaben: Frist, Bearbeitungstag oder Nachfassdatum liegt vor heute -- auch wenn
// die Aufgabe auf einen spaeteren Tag verschoben wurde (damit nichts vergessen geht). Bei einem
// abgelaufenen Projekt erscheinen seine offenen Teilaufgaben. Aelteste zuerst.
function abgelaufene(offene, { heute, ichId = null }) {
  const koepfe = new Map(offene
    .filter((p) => p.teilaufgaben_gesamt > 0 && p.status !== 'Erledigt' && p.geplant !== false && meine(p, ichId))
    .map((k) => [k.id, abgelaufenGrund(k, heute)])
    .filter(([, g]) => g));
  const liste = [];
  for (const p of offene) {
    if (p.status === 'Erledigt' || !istArbeit(p) || !meine(p, ichId)) continue;
    const grund = abgelaufenGrund(p, heute) ?? koepfe.get(p.uebergeordnete_pendenz_id) ?? null;
    if (grund) liste.push({ ...p, abgelaufen: grund });
  }
  return liste.sort((a, b) => a.abgelaufen.datum.localeCompare(b.abgelaufen.datum) || sortierung(a, b));
}

// Tage zwischen zwei ISO-Daten (b - a).
function tageZwischen(a, b) {
  const t = (iso) => { const [j, m, d] = iso.split('-').map(Number); return Date.UTC(j, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400000);
}

// Ordner "Zu planen": offene Pendenzen (Offen/Spaeter) ohne Bearbeitungstag -- egal ob mit
// oder ohne Frist. Projekt-Koepfe nicht (ihre Teilaufgaben erscheinen darunter).
function zuPlanen(offene) {
  return offene
    .filter((p) => ['Offen', 'Später'].includes(p.status) && istArbeit(p) && !p.bearbeitungstag)
    .sort(sortierung);
}

const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

// "Morgen" oder z.B. "Montag", wenn der naechste Arbeitstag nicht morgen ist.
function morgenTitel(heute, tag) {
  const [j, m, t] = heute.split('-').map(Number);
  const morgen = new Date(Date.UTC(j, m - 1, t + 1)).toISOString().slice(0, 10);
  if (tag === morgen) return 'Morgen';
  const [j2, m2, t2] = tag.split('-').map(Number);
  return WOCHENTAGE[new Date(Date.UTC(j2, m2 - 1, t2)).getUTCDay()];
}

export { tagesplan, zuPlanen, morgenTitel, istHeute, abgelaufene, abgelaufenGrund, tageZwischen };
