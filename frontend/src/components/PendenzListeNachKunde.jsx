import PendenzListe from './PendenzListe.jsx';
import { gruppiereNachMandant } from '../lib/gruppierung.js';

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
export default function PendenzListeNachKunde({
  pendenzen, onOeffnen, onStatusAendern, leerText = 'Keine Pendenzen.', ohneAbhaken = false,
  onVorschau, vorschauId,
}) {
  if (!pendenzen.length) {
    return (
      <div className="pendenz-liste-nach-kunde">
        <ListenKopf ohneAbhaken={ohneAbhaken} />
        <PendenzListe pendenzen={[]} onOeffnen={onOeffnen} onStatusAendern={onStatusAendern} leerText={leerText} ohneAbhaken={ohneAbhaken} mitKopf={false} />
      </div>
    );
  }

  const gruppen = gruppiereNachMandant(pendenzen);

  return (
    <div className="pendenz-liste-nach-kunde">
      <ListenKopf ohneAbhaken={ohneAbhaken} />
      {gruppen.map((gruppe) => (
        <div key={gruppe.mandantId ?? 'kein-mandant'} className="kunde-gruppe">
          <div className="kunde-gruppe-titel">
            <span>{gruppe.mandantName || 'Kein Mandant (intern)'}</span>
            {gruppe.mandantKuerzel && <span className="mandant-kuerzel">{gruppe.mandantKuerzel}</span>}
            <span className="zaehler-pille">{gruppe.items.length}</span>
          </div>
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
        </div>
      ))}
    </div>
  );
}
