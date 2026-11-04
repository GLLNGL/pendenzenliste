import { statusSlug } from '../constants.js';
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

// Schlichte, nach Mandant gruppierte Pendenzenliste -- gemeinsam fuer die Uebersicht und den
// Kalender im Cockpit: pro Mandant ein Zwischentitel, darunter eine Zeile pro Pendenz
// (naechster Schritt, optional Frist, Status). Klick waehlt die Pendenz fuer die Detailansicht
// rechts; Status aendern und alles Weitere geschieht dort bzw. im Bearbeiten-Fenster.
export default function PendenzGruppenListe({ pendenzen, aktiveId, onWaehlen, mitFrist = false, leerText }) {
  if (!pendenzen.length) return leerText ? <div className="leer-hinweis">{leerText}</div> : null;
  const heute = heutigesDatumISO();

  return gruppiertNachMandant(pendenzen).map((gruppe) => (
    <div key={gruppe.schluessel} className="tagesliste-gruppe">
      <div className="tagesliste-gruppe-titel">
        {gruppe.name}
        <span className="tagesliste-gruppe-anzahl">{gruppe.items.length}</span>
      </div>
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
                <span className={`tagesliste-status status-${statusSlug(p.status)}`}>{p.status}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  ));
}
