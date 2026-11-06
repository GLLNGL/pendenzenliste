import { useState } from 'react';

// Ablage eines Mandanten: SharePoint-/OneDrive-Ordner im Browser oeffnen und den Windows-Pfad
// kopieren (zum Einfuegen in die Adresszeile des Explorers -- eine Web-App darf den Explorer
// nicht selbst oeffnen).
export default function AblageKnoepfe({ mandant }) {
  const [kopiert, setKopiert] = useState(false);
  if (!mandant || (!mandant.ablage_link && !mandant.ablage_pfad)) return null;

  async function pfadKopieren(e) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(mandant.ablage_pfad);
      setKopiert(true);
      setTimeout(() => setKopiert(false), 2000);
    } catch {
      window.prompt('Pfad kopieren (Ctrl+C):', mandant.ablage_pfad);
    }
  }

  return (
    <span className="ablage-knoepfe">
      {mandant.ablage_link && (
        <a className="btn-klein" href={mandant.ablage_link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Ablage des Mandanten öffnen (SharePoint/OneDrive)">
          📁 Ablage öffnen
        </a>
      )}
      {mandant.ablage_pfad && (
        <button type="button" className="btn-klein" onClick={pfadKopieren} title={`${mandant.ablage_pfad}\nKopieren und im Explorer in die Adresszeile einfügen`}>
          {kopiert ? '✓ Pfad kopiert' : 'Explorer-Pfad kopieren'}
        </button>
      )}
    </span>
  );
}
