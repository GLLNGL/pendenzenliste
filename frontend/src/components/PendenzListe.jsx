import { Fragment, useRef, useState } from 'react';
import PendenzZeile from './PendenzZeile.jsx';

// Baut aus der flachen (bereits sortierten) Liste eine Eltern/Kinder-Struktur: Teilaufgaben,
// deren Hauptaufgabe ebenfalls in der aktuellen Liste enthalten ist, werden direkt darunter
// eingerueckt dargestellt. Ist die Hauptaufgabe nicht Teil dieser Liste (z.B. weil sie in einen
// anderen Cockpit-Block oder Status faellt), bleibt die Teilaufgabe eine normale Zeile.
function baueBaum(pendenzen) {
  const vorhandeneIds = new Set(pendenzen.map((p) => p.id));
  const kinderVonEltern = new Map();
  const wurzeln = [];

  for (const p of pendenzen) {
    if (p.uebergeordnete_pendenz_id && vorhandeneIds.has(p.uebergeordnete_pendenz_id)) {
      const liste = kinderVonEltern.get(p.uebergeordnete_pendenz_id) || [];
      liste.push(p);
      kinderVonEltern.set(p.uebergeordnete_pendenz_id, liste);
    } else {
      wurzeln.push(p);
    }
  }

  return { wurzeln, kinderVonEltern };
}

// Tastaturfreundliche Tabelle: Pfeiltasten bewegen den Fokus innerhalb der Liste,
// Enter oeffnet die Detailansicht, Leertaste hakt ab (bzw. macht das Abhaken rueckgaengig).
export default function PendenzListe({
  pendenzen, onOeffnen, onStatusAendern, leerText = 'Keine Pendenzen.', ohneAbhaken = false, mitKopf = true,
  onVorschau, vorschauId,
}) {
  const containerRef = useRef(null);
  const [eingeklappt, setEingeklappt] = useState(() => new Set());

  function toggleEinklappen(id) {
    setEingeklappt((vorherige) => {
      const naechste = new Set(vorherige);
      if (naechste.has(id)) naechste.delete(id); else naechste.add(id);
      return naechste;
    });
  }

  function onKeyDown(e, pendenz) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const zeilen = Array.from(containerRef.current.querySelectorAll('[data-zeile]'));
      const idx = zeilen.indexOf(e.currentTarget);
      const ziel = e.key === 'ArrowDown' ? zeilen[idx + 1] : zeilen[idx - 1];
      ziel?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (onVorschau) onVorschau(pendenz); else onOeffnen(pendenz);
    } else if (e.key === ' ' || e.code === 'Space') {
      // e.code als Fallback: manche Eingabequellen (z.B. Automatisierung) liefern
      // bei der Leertaste ein leeres e.key.
      e.preventDefault();
      onStatusAendern(pendenz, pendenz.status === 'Erledigt' ? 'Offen' : 'Erledigt');
    }
  }

  // Die Tabelle (samt Kopfzeile) bleibt auch ohne Treffer stehen -- sonst springt beim
  // Wechseln zwischen Kategorien/Tagen staendig "Titel / Mandant / Status / Fällig" weg und
  // wieder hin.
  const { wurzeln, kinderVonEltern } = baueBaum(pendenzen);
  const spaltenAnzahl = ohneAbhaken ? 4 : 5;

  return (
    <div className="pendenz-tabelle-wrap" ref={containerRef}>
      <table className="pendenz-tabelle">
        <colgroup>
          {!ohneAbhaken && <col className="col-check" />}
          <col />
          <col className="col-mandant" />
          <col className="col-status" />
          <col className="col-faellig" />
        </colgroup>
        {mitKopf && (
          <thead>
            <tr>
              {!ohneAbhaken && <th aria-hidden="true"></th>}
              <th>Titel</th>
              <th>Mandant / Bearbeiter</th>
              <th>Status</th>
              <th>Fällig</th>
            </tr>
          </thead>
        )}
        <tbody>
          {!pendenzen.length && (
            <tr><td colSpan={spaltenAnzahl} className="leer-hinweis">{leerText}</td></tr>
          )}
          {wurzeln.map((p) => {
            const kinder = kinderVonEltern.get(p.id) || [];
            const hatKinder = kinder.length > 0;
            const istEingeklappt = eingeklappt.has(p.id);
            return (
              <Fragment key={p.id}>
                <PendenzZeile
                  pendenz={p}
                  onOeffnen={onOeffnen}
                  onStatusAendern={onStatusAendern}
                  onKeyDown={onKeyDown}
                  hatKinder={hatKinder}
                  eingeklappt={istEingeklappt}
                  onToggleEinklappen={hatKinder ? () => toggleEinklappen(p.id) : undefined}
                  ohneAbhaken={ohneAbhaken}
                  onVorschau={onVorschau}
                  istVorschau={p.id === vorschauId}
                />
                {hatKinder && !istEingeklappt && kinder.map((k, idx) => (
                  <PendenzZeile
                    key={k.id}
                    pendenz={k}
                    onOeffnen={onOeffnen}
                    onStatusAendern={onStatusAendern}
                    onKeyDown={onKeyDown}
                    eingezogen
                    anzeigeId={`${p.id}.${idx + 1}`}
                    ohneAbhaken={ohneAbhaken}
                    onVorschau={onVorschau}
                    istVorschau={k.id === vorschauId}
                  />
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
