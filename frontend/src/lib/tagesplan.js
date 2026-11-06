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

// Gehoert eine offene Pendenz auf den Tag? Bearbeitungstag bis heute, Frist bis heute
// (Ueberfaelliges eingeschlossen), "In Arbeit", faelliges Nachfassen.
function istHeute(p, heute) {
  if (p.status === 'Warten auf') return (p.wiedervorlage && p.wiedervorlage <= heute) || (p.faelligkeit && p.faelligkeit <= heute);
  if (p.status === 'In Arbeit') return true;
  return (p.bearbeitungstag && p.bearbeitungstag <= heute) || (p.faelligkeit && p.faelligkeit <= heute);
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
  const aktiverSchritt = (p, ids) => ids.has(p.uebergeordnete_pendenz_id) && ['Offen', 'In Arbeit'].includes(p.status);

  const heuteOffen = offen.filter((p) => istHeute(p, heute) || aktiverSchritt(p, kopfHeute)).sort(sortierung);
  const heuteIds = new Set(heuteOffen.map((p) => p.id));
  const morgenOffen = offen
    .filter((p) => !heuteIds.has(p.id) && (p.bearbeitungstag === morgenTag || p.faelligkeit === morgenTag
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

export { tagesplan, zuPlanen, morgenTitel, istHeute };
