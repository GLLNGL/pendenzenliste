import { useState } from 'react';
import PendenzGruppenListe from './PendenzGruppenListe.jsx';
import PendenzVorschau from './PendenzVorschau.jsx';
import { aufwandSumme, formatiereStunden } from '../constants.js';

// Einheitliche Arbeitskarte fuer alle Pendenzen-Ansichten (Cockpit-Uebersicht, Alle Pendenzen,
// Mandanten, Archiv): Kopf mit Titel, Anzahl und geschaetzter Gesamtzeit; darunter optional eine
// linke Spalte (z.B. Bereiche im Cockpit, Mandanten), in der Mitte die nach Mandant gruppierte
// Liste (einklappbar) und rechts die Detailansicht der angeklickten Pendenz -- ein Klick darin
// oeffnet das Bearbeiten-Fenster.
export default function PendenzArbeitsliste({
  titel, pendenzen, datum = 'faelligkeit', leerText, speicherSchluessel,
  onOeffnen, onStatusAendern, links, oben, className = '',
}) {
  const [vorschauPendenz, setVorschauPendenz] = useState(null);
  // Frischen Datensatz nachschlagen statt das alte vorschauPendenz-Objekt weiterzuverwenden --
  // sonst zeigt die Vorschau nach einer Aenderung weiter den veralteten Stand. Ist die Pendenz
  // nicht mehr in der Liste (Filter- oder Bereichswechsel, erledigt), blendet sie sich aus.
  const angezeigtePendenz = vorschauPendenz
    ? pendenzen.find((p) => p.id === vorschauPendenz.id) ?? null
    : null;
  const summe = aufwandSumme(pendenzen);
  const anzahl = pendenzen.filter((p) => !(p.teilaufgaben_gesamt > 0)).length;

  return (
    <div className={`karte karte-kalender uebersicht-karte ${className}`}>
      <div className="karte-kopf uebersicht-kopf">
        <span>{titel}</span>
        <span className="uebersicht-kopf-summe">
          {anzahl} Pendenz{anzahl === 1 ? '' : 'en'}
          {' · '}
          <strong>{formatiereStunden(summe.minuten)}</strong> geschätzt
          {summe.ohne > 0 && <span className="uebersicht-kopf-ohne"> ({summe.ohne} ohne Schätzung)</span>}
        </span>
      </div>

      <div className="uebersicht-layout">
        {links}

        <div className={`uebersicht-liste ${links ? '' : 'ohne-links'}`}>
          {oben}
          <PendenzGruppenListe
            pendenzen={pendenzen}
            aktiveId={angezeigtePendenz?.id}
            onWaehlen={setVorschauPendenz}
            datum={datum}
            speicherSchluessel={speicherSchluessel}
            leerText={leerText}
          />
        </div>

        <PendenzVorschau pendenz={angezeigtePendenz} onOeffnen={onOeffnen} onStatusAendern={onStatusAendern} />
      </div>
    </div>
  );
}
