import { useState } from 'react';
import { useAblageGrund } from '../hooks.js';
import { ablageVon } from '../lib/ablage.js';

// Ablage eines Mandanten: SharePoint-/OneDrive-Ordner im Browser oeffnen und den Windows-Pfad
// kopieren (zum Einfuegen in die Adresszeile des Explorers -- eine Web-App darf den Explorer
// nicht selbst oeffnen). Pfad/Link aus Grundordner (Einstellungen) + Ordnername des Mandanten.
export default function AblageKnoepfe({ mandant }) {
  const [kopiert, setKopiert] = useState(false);
  const grund = useAblageGrund();
  const { pfad, link } = ablageVon(mandant, grund);
  if (!mandant || (!link && !pfad)) return null;

  async function pfadKopieren(e) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(pfad);
      setKopiert(true);
      setTimeout(() => setKopiert(false), 2000);
    } catch {
      window.prompt('Pfad kopieren (Ctrl+C):', pfad);
    }
  }

  return (
    <span className="ablage-knoepfe">
      {link && (
        <a className="btn-klein" href={link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Ablage des Mandanten öffnen (SharePoint/OneDrive)">
          📁 Ablage öffnen
        </a>
      )}
      {pfad && (
        <button type="button" className="btn-klein" onClick={pfadKopieren} title={`${pfad}\nKopieren und im Explorer in die Adresszeile einfügen`}>
          {kopiert ? '✓ Pfad kopiert' : 'Explorer-Pfad kopieren'}
        </button>
      )}
    </span>
  );
}
