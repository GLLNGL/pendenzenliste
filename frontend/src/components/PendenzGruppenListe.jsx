import { useState } from 'react';
import { aufwandSumme, formatiereAufwand, formatiereStunden, statusSlug } from '../constants.js';
import { formatiereDatum, heutigesDatumISO } from '../format.js';

// Reihenfolge innerhalb eines Mandanten: nach Projekt bzw. Titel, der Projekt-Kopf vor seinen
// Schritten, die Schritte in ihrer Reihenfolge -- ein Projekt steht so als Block beieinander.
function vergleiche(a, b) {
  return (a.eltern_titel || a.titel).localeCompare(b.eltern_titel || b.titel, 'de-CH')
    || (a.uebergeordnete_pendenz_id != null) - (b.uebergeordnete_pendenz_id != null)
    || (a.reihenfolge ?? 0) - (b.reihenfolge ?? 0);
}

// Pendenzen pro Mandant gruppiert (alphabetisch, "Intern" zuletzt).
function gruppiertNachMandant(liste) {
  const gruppen = new Map();
  for (const p of liste) {
    const schluessel = p.mandant_id ?? 'intern';
    if (!gruppen.has(schluessel)) gruppen.set(schluessel, { schluessel, name: p.mandant_name || 'Intern (eigenes Büro)', items: [] });
    gruppen.get(schluessel).items.push(p);
  }
  return [...gruppen.values()]
    .sort((a, b) => (a.schluessel === 'intern') - (b.schluessel === 'intern') || a.name.localeCompare(b.name, 'de-CH'))
    .map((g) => ({ ...g, items: g.items.sort(vergleiche) }));
}

const DATUM_TITEL = { faelligkeit: 'Frist', erledigt_am: 'Erledigt am' };

// Aufgeklappte Projekte (Schritte sichtbar) -- in allen Listen gemeinsam gemerkt. Standard:
// eingeklappt, nur der Projekt-Kopf ist zu sehen.
const PROJEKTE_SCHLUESSEL = 'pendenzen-projekte-offen';
function offeneProjekteLesen() {
  try {
    const liste = JSON.parse(localStorage.getItem(PROJEKTE_SCHLUESSEL));
    return new Set(Array.isArray(liste) ? liste.map(Number) : []);
  } catch {
    return new Set();
  }
}

function eingeklapptLesen(schluessel) {
  if (!schluessel) return new Set();
  try {
    const liste = JSON.parse(localStorage.getItem(schluessel));
    return new Set(Array.isArray(liste) ? liste.map(String) : []);
  } catch {
    return new Set();
  }
}

// Text fuer die geschaetzte Zeit einer Gruppe, z.B. "3.5 h" bzw. "3.5 h + 2 ohne Schätzung".
function zeitText({ minuten, ohne }) {
  if (!minuten && ohne) return 'ohne Schätzung';
  return ohne ? `${formatiereStunden(minuten)} + ${ohne} ohne Schätzung` : formatiereStunden(minuten);
}

// Schlichte, nach Mandant gruppierte Pendenzenliste -- gemeinsam fuer die Uebersicht und den
// Kalender im Cockpit: pro Mandant ein Kopf (Name, Anzahl, geschaetzte Gesamtzeit), darunter eine
// Zeile pro Pendenz (naechster Schritt, optional Frist, geschaetzte Zeit, Status). Ein Klick auf
// den Kopf klappt die Pendenzen des Mandanten ein bzw. aus (pro Liste im Browser gemerkt); ein
// Klick auf eine Pendenz waehlt sie fuer die Detailansicht rechts.
// datum: welche Datumsspalte gezeigt wird -- 'faelligkeit' (Frist, ueberfaellig rot),
// 'erledigt_am' (Archiv) oder keine (Kalender: das Datum ist der angeklickte Tag).
export default function PendenzGruppenListe({ pendenzen, aktiveId, onWaehlen, mitFrist = false, datum, leerText, speicherSchluessel }) {
  const datumFeld = datum ?? (mitFrist ? 'faelligkeit' : null);
  const [eingeklappt, setEingeklappt] = useState(() => eingeklapptLesen(speicherSchluessel));
  const [offeneProjekte, setOffeneProjekte] = useState(offeneProjekteLesen);

  function projektUmschalten(projektId) {
    const neu = new Set(offeneProjekte);
    if (neu.has(projektId)) neu.delete(projektId); else neu.add(projektId);
    setOffeneProjekte(neu);
    try { localStorage.setItem(PROJEKTE_SCHLUESSEL, JSON.stringify([...neu])); } catch { /* ohne Speicher weiter nutzbar */ }
  }

  if (!pendenzen.length) return leerText ? <div className="leer-hinweis">{leerText}</div> : null;
  const heute = heutigesDatumISO();

  function umschalten(schluessel) {
    const neu = new Set(eingeklappt);
    const k = String(schluessel);
    if (neu.has(k)) neu.delete(k); else neu.add(k);
    setEingeklappt(neu);
    if (speicherSchluessel) {
      try { localStorage.setItem(speicherSchluessel, JSON.stringify([...neu])); } catch { /* ohne Speicher weiter nutzbar */ }
    }
  }

  // Tabellen-Layout wie der Leistungskatalog: eine Kopfzeile mit Spaltennamen ueber allen
  // Gruppen, die Spalten stehen in jeder Zeile genau darunter.
  const kopfzeile = (
    <div key="kopf" className={`tagesliste-kopf ${datumFeld ? 'mit-frist' : ''}`} aria-hidden="true">
      <span className="tagesliste-kopf-titel">Nächster Schritt</span>
      <span className="tagesliste-kopf-block">Block</span>
      <span className="tagesliste-kopf-prio">Prio</span>
      {datumFeld && <span>{DATUM_TITEL[datumFeld]}</span>}
      <span className="tagesliste-kopf-zahl">Aufwand</span>
      <span>Status</span>
    </div>
  );

  return [kopfzeile, ...gruppiertNachMandant(pendenzen).map((gruppe) => {
    const zu = eingeklappt.has(String(gruppe.schluessel));
    return (
      <div key={gruppe.schluessel} className={`tagesliste-gruppe ${zu ? 'eingeklappt' : ''}`}>
        <button
          type="button"
          className="tagesliste-gruppe-titel"
          onClick={() => umschalten(gruppe.schluessel)}
          aria-expanded={!zu}
          title={zu ? 'Pendenzen anzeigen' : 'Pendenzen einklappen'}
        >
          <span className="tagesliste-gruppe-pfeil" aria-hidden="true">{zu ? '▸' : '▾'}</span>
          <span className="tagesliste-gruppe-name">{gruppe.name}</span>
          {/* Wie im Kartenkopf: Projekt-Koepfe zaehlen nicht, nur die konkreten Pendenzen/Schritte. */}
          <span className="tagesliste-gruppe-anzahl">{gruppe.items.filter((p) => !(p.teilaufgaben_gesamt > 0)).length}</span>
          <span className="tagesliste-gruppe-zeit">{zeitText(aufwandSumme(gruppe.items))}</span>
        </button>
        {!zu && (
          <ul className="tagesliste">
            {gruppe.items.flatMap((p, index) => {
              const ueberfaellig = datumFeld === 'faelligkeit' && p.status !== 'Erledigt' && p.faelligkeit < heute;
              const istProjekt = p.teilaufgaben_gesamt > 0;
              const istSchritt = p.uebergeordnete_pendenz_id != null;
              // Projekte als Aufzaehlung: Schritte stehen mit Aufzaehlungsstrich unter ihrem
              // Projekt. Ist der Projekt-Kopf selbst nicht in der Liste (Cockpit, Kalender), wird
              // vor dem ersten Schritt eine Projekt-Titelzeile eingefuegt.
              const kopfInListe = istSchritt && gruppe.items.some((k) => k.id === p.uebergeordnete_pendenz_id);
              // Struktur Mandant -> Projekt -> Teilaufgaben: Teilaufgaben sind eingeklappt, bis
              // das Projekt aufgeklappt wird (auch wenn nur die Teilaufgaben in der Liste stehen).
              const schrittSichtbar = !istSchritt || offeneProjekte.has(p.uebergeordnete_pendenz_id);
              const projektOffen = istProjekt && offeneProjekte.has(p.id);
              const vorgaenger = gruppe.items[index - 1];
              const nachfolger = gruppe.items[index + 1];
              const brauchtTitelzeile = istSchritt && !kopfInListe
                && vorgaenger?.uebergeordnete_pendenz_id !== p.uebergeordnete_pendenz_id;
              // Letzter Schritt eines Projekts: dort endet die Fuehrungslinie (└ statt ├).
              const letzterSchritt = istSchritt && nachfolger?.uebergeordnete_pendenz_id !== p.uebergeordnete_pendenz_id;
              const zeilen = [];
              if (brauchtTitelzeile) {
                const elternId = p.uebergeordnete_pendenz_id;
                const anzahlHier = gruppe.items.filter((k) => k.uebergeordnete_pendenz_id === elternId).length;
                const offen = offeneProjekte.has(elternId);
                zeilen.push(
                  <li key={`projekt-${elternId}`}>
                    <button
                      type="button"
                      className="tagesliste-projektzeile"
                      onClick={() => projektUmschalten(elternId)}
                      aria-expanded={offen}
                      title={offen ? 'Teilaufgaben einklappen' : 'Teilaufgaben anzeigen'}
                    >
                      <span className="tagesliste-projekt-pfeil" aria-hidden="true">{offen ? '▾' : '▸'}</span>
                      <span className="tagesliste-projekt-name">{p.eltern_titel}</span>
                      <span className="tagesliste-projekt-anzahl">{anzahlHier} {anzahlHier === 1 ? 'Teilaufgabe' : 'Teilaufgaben'}</span>
                    </button>
                  </li>,
                );
              }
              if (!schrittSichtbar) return zeilen;
              zeilen.push(
                <li key={p.id} className={istProjekt ? 'mit-umschalter' : undefined}>
                  {istProjekt && (
                    <button
                      type="button"
                      className="tagesliste-umschalter"
                      onClick={() => projektUmschalten(p.id)}
                      aria-expanded={projektOffen}
                      title={projektOffen ? 'Teilaufgaben einklappen' : `${p.teilaufgaben_gesamt} Teilaufgaben anzeigen`}
                    >
                      {projektOffen ? '▾' : '▸'}
                    </button>
                  )}
                  <button
                    type="button"
                    className={`tagesliste-eintrag ${datumFeld ? 'mit-frist' : ''} ${aktiveId === p.id ? 'aktiv' : ''} ${p.prioritaet === 'A' ? 'prio-a' : ''} ${istProjekt ? 'projekt' : ''} ${istSchritt ? 'schritt' : ''} ${letzterSchritt ? 'letzter' : ''}`}
                    onClick={() => onWaehlen(p)}
                    title={p.eltern_titel ? `${p.eltern_titel} – ${p.titel}` : p.titel}
                  >
                    <span className="tagesliste-titel">
                      {p.titel}
                      {istProjekt && (
                        <span className="tagesliste-projekt-anzahl">{p.teilaufgaben_gesamt} {p.teilaufgaben_gesamt === 1 ? 'Teilaufgabe' : 'Teilaufgaben'}{p.teilaufgaben_erledigt > 0 ? ` · ${p.teilaufgaben_erledigt} erledigt` : ''}</span>
                      )}
                    </span>
                    <span className="tagesliste-block">{p.block && p.block !== 'Sonstiges' ? p.block : ''}</span>
                    <span className={`tagesliste-prio prio-${String(p.prioritaet || '').toLowerCase()}`}>{istProjekt ? '' : p.prioritaet}</span>
                    {datumFeld && (
                      <span className={`tagesliste-frist ${ueberfaellig ? 'ueberfaellig' : ''}`} title={DATUM_TITEL[datumFeld]}>
                        {formatiereDatum(p[datumFeld])}
                        {datumFeld === 'faelligkeit' && p.harte_frist && <span className="zeile-harte-frist" title="Harte Frist (Behörde/Zahlung)">!</span>}
                      </span>
                    )}
                    <span className={`tagesliste-aufwand ${p.aufwand_minuten == null ? 'leer' : ''}`}>
                      {p.aufwand_minuten == null ? (istProjekt ? '' : '–') : formatiereAufwand(p.aufwand_minuten)}
                    </span>
                    <span className={`tagesliste-status status-${statusSlug(p.status)}`}>{p.status}</span>
                  </button>
                </li>,
              );
              return zeilen;
            })}
          </ul>
        )}
      </div>
    );
  })];
}
