import { useState } from 'react';
import PendenzListe from './PendenzListe.jsx';
import { gruppiereNachMandant } from '../lib/gruppierung.js';

function eingeklapptLesen(schluessel) {
  if (!schluessel) return new Set();
  try {
    const liste = JSON.parse(localStorage.getItem(schluessel));
    return new Set(Array.isArray(liste) ? liste : []);
  } catch {
    return new Set();
  }
}

// Eigene, von den Kunde-Gruppen losgeloeste Kopfzeile -- erscheint nur EINMAL ganz oben (auf
// gleicher Hoehe wie der Listenanfang), nicht mehr pro Gruppe wiederholt. Gleiches colgroup wie
// PendenzListe, damit die Spalten exakt zu den Tabellen darunter fluchten.
function ListenKopf({ ohneAbhaken }) {
  return (
    <table className="pendenz-tabelle pendenz-liste-nach-kunde-kopf">
      <colgroup>
        {!ohneAbhaken && <col className="col-check" />}
        <col />
        <col className="col-mandant" />
        <col className="col-aufwand" />
        <col className="col-status" />
        <col className="col-faellig" />
      </colgroup>
      <thead>
        <tr>
          {!ohneAbhaken && <th aria-hidden="true"></th>}
          <th>Titel</th>
          <th>Bearbeiter</th>
          <th>Aufwand</th>
          <th>Status</th>
          <th>Fällig</th>
        </tr>
      </thead>
    </table>
  );
}

// Huelle um PendenzListe: zeigt den Mandanten als eigene Gruppenueberschrift ueber seinen
// Pendenzen, statt ihn nur als Spalte in einer langen flachen Tabelle zu fuehren -- dieselbe
// Optik wie die bestehende Kunde/Status-Gruppierung in Mandanten.jsx, hier aber ueberall sonst
// eingesetzt (Cockpit, Kalender-Tagesliste, Alle Pendenzen), wo bisher eine flache Liste stand.
// Jede Gruppe laesst sich einklappen; mit "speicherSchluessel" wird der Zustand im Browser
// gemerkt (pro Ansicht eigener Schluessel, damit z.B. Cockpit und Alle Pendenzen unabhaengig sind).
export default function PendenzListeNachKunde({
  pendenzen, onOeffnen, onStatusAendern, leerText = 'Keine Pendenzen.', ohneAbhaken = false,
  onVorschau, vorschauId, speicherSchluessel,
}) {
  const [eingeklappt, setEingeklappt] = useState(() => eingeklapptLesen(speicherSchluessel));

  function setzen(neu) {
    setEingeklappt(neu);
    if (!speicherSchluessel) return;
    try { localStorage.setItem(speicherSchluessel, JSON.stringify([...neu])); } catch { /* ohne Speicher weiter nutzbar */ }
  }

  function toggle(schluessel) {
    const neu = new Set(eingeklappt);
    if (neu.has(schluessel)) neu.delete(schluessel); else neu.add(schluessel);
    setzen(neu);
  }

  if (!pendenzen.length) {
    return (
      <div className="pendenz-liste-nach-kunde">
        <ListenKopf ohneAbhaken={ohneAbhaken} />
        <PendenzListe pendenzen={[]} onOeffnen={onOeffnen} onStatusAendern={onStatusAendern} leerText={leerText} ohneAbhaken={ohneAbhaken} mitKopf={false} />
      </div>
    );
  }

  const gruppen = gruppiereNachMandant(pendenzen);
  const schluesselVon = (gruppe) => String(gruppe.mandantId ?? 'kein-mandant');

  return (
    <div className="pendenz-liste-nach-kunde">
      <ListenKopf ohneAbhaken={ohneAbhaken} />
      {gruppen.length > 1 && (
        <div className="kunde-gruppen-werkzeuge">
          <button type="button" className="btn-klein" onClick={() => setzen(new Set(gruppen.map(schluesselVon)))}>Alle einklappen</button>
          <button type="button" className="btn-klein" onClick={() => setzen(new Set())}>Alle ausklappen</button>
        </div>
      )}
      {gruppen.map((gruppe) => {
        const schluessel = schluesselVon(gruppe);
        const istEingeklappt = eingeklappt.has(schluessel);
        return (
          <div key={schluessel} className="kunde-gruppe">
            <div
              className={`kunde-gruppe-titel kunde-gruppe-titel-klickbar ${istEingeklappt ? 'eingeklappt' : ''}`}
              onClick={() => toggle(schluessel)}
            >
              <button
                type="button"
                className="mandant-einklapp-toggle"
                aria-expanded={!istEingeklappt}
                aria-label={istEingeklappt ? 'Gruppe ausklappen' : 'Gruppe einklappen'}
                onClick={(e) => { e.stopPropagation(); toggle(schluessel); }}
              >
                {istEingeklappt ? '▸' : '▾'}
              </button>
              <span>{gruppe.mandantName || 'Kein Mandant (intern)'}</span>
              {gruppe.mandantKuerzel && <span className="mandant-kuerzel">{gruppe.mandantKuerzel}</span>}
              <span className="zaehler-pille">{gruppe.items.length}</span>
            </div>
            {!istEingeklappt && (
              <PendenzListe
                pendenzen={gruppe.items}
                onOeffnen={onOeffnen}
                onStatusAendern={onStatusAendern}
                leerText={leerText}
                ohneAbhaken={ohneAbhaken}
                mitKopf={false}
                ohneMandantSpalte
                onVorschau={onVorschau}
                vorschauId={vorschauId}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
