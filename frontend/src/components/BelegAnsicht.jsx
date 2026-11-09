import { useEffect, useState } from 'react';
import { dateiLesen } from '../lib/ablageOrdner.js';

// Zeigt eine Rechnung (PDF oder Bild) zum Abgleichen der Angaben: entweder die gerade
// hineingezogene Datei oder den bereits abgelegten Beleg aus dem OneDrive-Ordner.
export default function BelegAnsicht({ file = null, pfad = null }) {
  const [geladen, setGeladen] = useState(null); // File aus OneDrive
  const [fehler, setFehler] = useState(null);
  const [url, setUrl] = useState(null);
  const quelle = file ?? geladen;

  async function ausOneDrive() {
    setFehler(null);
    try { setGeladen(await dateiLesen(pfad)); } catch (err) { setFehler(err.message); }
  }

  useEffect(() => {
    if (file || !pfad) return undefined;
    const zeitgeber = setTimeout(ausOneDrive, 0);
    return () => clearTimeout(zeitgeber);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, pfad]);

  useEffect(() => {
    if (!quelle) return undefined;
    const u = URL.createObjectURL(quelle);
    const zeitgeber = setTimeout(() => setUrl(u), 0);
    return () => { clearTimeout(zeitgeber); URL.revokeObjectURL(u); };
  }, [quelle]);

  if (!quelle || !url) {
    return (
      <div className="beleg-ansicht-leer">
        {!pfad && !file && 'Kein Beleg hinterlegt.'}
        {pfad && !fehler && 'Beleg wird aus OneDrive geladen…'}
        {fehler && (
          <>
            <p>{fehler}</p>
            <button type="button" className="btn-klein" onClick={ausOneDrive}>Beleg anzeigen</button>
          </>
        )}
      </div>
    );
  }
  const istBild = /^image\//.test(quelle.type);
  return istBild
    ? <img className="beleg-ansicht-bild" src={url} alt="Beleg" />
    : <iframe className="beleg-ansicht" src={url} title="Beleg" />;
}
