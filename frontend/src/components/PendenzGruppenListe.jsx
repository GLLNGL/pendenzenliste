import { useState } from 'react';
import { aufwandSumme, formatiereAufwand, formatiereStunden, statusSlug } from '../constants.js';
import { formatiereDatum, heutigesDatumISO } from '../format.js';

// Pendenzen pro Mandant gruppiert (alphabetisch, "Intern" zuletzt), innerhalb einer Gruppe nach
// Projekt bzw. Titel -- Schritte desselben Projekts stehen so beieinander.
function gruppiertNachMandant(liste) {
  const gruppen = new Map();
  for (const p of liste) {
    const schluessel = p.mandant_id ?? 'intern';
    if (!gruppen.has(schluessel)) gruppen.set(schluessel, { schluessel, name: p.mandant_name || 'Intern (eigenes Büro)', items: [] });
    gruppen.get(schluessel).items.push(p);
  }
  return [...gruppen.values()]
    .sort((a, b) => (a.schluessel === 'intern') - (b.schluessel === 'intern') || a.name.localeCompare(b.name, 'de-CH'))
    .map((g) => ({ ...g, items: g.items.sort((a, b) => (a.eltern_titel || a.titel).localeCompare(b.eltern_titel || b.titel, 'de-CH')) }));
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
export default function PendenzGruppenListe({ pendenzen, aktiveId, onWaehlen, mitFrist = false, leerText, speicherSchluessel }) {
  const [eingeklappt, setEingeklappt] = useState(() => eingeklapptLesen(speicherSchluessel));

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

  return gruppiertNachMandant(pendenzen).map((gruppe) => {
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
          <span className="tagesliste-gruppe-anzahl">{gruppe.items.length}</span>
          <span className="tagesliste-gruppe-zeit">{zeitText(aufwandSumme(gruppe.items))}</span>
        </button>
        {!zu && (
          <ul className="tagesliste">
            {gruppe.items.map((p) => {
              const ueberfaellig = p.status !== 'Erledigt' && p.faelligkeit < heute;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`tagesliste-eintrag ${mitFrist ? 'mit-frist' : ''} ${aktiveId === p.id ? 'aktiv' : ''} ${p.prioritaet === 'A' ? 'prio-a' : ''}`}
                    onClick={() => onWaehlen(p)}
                    title={p.titel}
                  >
                    <span className="tagesliste-titel">
                      {p.eltern_titel && <span className="tagesliste-eltern">{p.eltern_titel} › </span>}
                      {p.titel}
                    </span>
                    {mitFrist && (
                      <span className={`tagesliste-frist ${ueberfaellig ? 'ueberfaellig' : ''}`}>
                        {formatiereDatum(p.faelligkeit)}
                        {p.harte_frist && <span className="zeile-harte-frist" title="Harte Frist (Behörde/Zahlung)">!</span>}
                      </span>
                    )}
                    <span className={`tagesliste-aufwand ${p.aufwand_minuten == null ? 'leer' : ''}`}>
                      {p.aufwand_minuten == null ? '–' : formatiereAufwand(p.aufwand_minuten)}
                    </span>
                    <span className={`tagesliste-status status-${statusSlug(p.status)}`}>{p.status}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  });
}
