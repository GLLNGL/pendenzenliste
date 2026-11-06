import { useEffect, useRef, useState } from 'react';

const Erkennung = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

// Mikrofon-Knopf: diktierter Text wird an das Feld angehaengt (Spracherkennung des Browsers,
// Deutsch/Schweiz). Laeuft in Edge und Chrome (auch auf dem Handy); die Sprache wird dafuer
// vom Browser an den Erkennungsdienst von Microsoft bzw. Google geschickt.
export default function DiktatKnopf({ onText, titel = 'Diktieren' }) {
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState(null);
  const erkennungRef = useRef(null);
  const onTextRef = useRef(onText);

  useEffect(() => { onTextRef.current = onText; }, [onText]);
  useEffect(() => () => erkennungRef.current?.abort(), []);

  if (!Erkennung) return null;

  function starten() {
    setFehler(null);
    const e = new Erkennung();
    e.lang = 'de-CH';
    e.continuous = true;
    e.interimResults = false;
    e.onresult = (ereignis) => {
      for (let i = ereignis.resultIndex; i < ereignis.results.length; i += 1) {
        if (ereignis.results[i].isFinal) {
          const text = ereignis.results[i][0].transcript.trim();
          if (text) onTextRef.current(text);
        }
      }
    };
    e.onerror = (ereignis) => {
      setFehler(ereignis.error === 'not-allowed' ? 'Mikrofon nicht freigegeben – im Browser erlauben.' : 'Diktat unterbrochen.');
      setLaeuft(false);
    };
    e.onend = () => setLaeuft(false);
    erkennungRef.current = e;
    e.start();
    setLaeuft(true);
  }

  function stoppen() {
    erkennungRef.current?.stop();
    setLaeuft(false);
  }

  return (
    <span className="diktat">
      <button
        type="button"
        className={`diktat-knopf ${laeuft ? 'aktiv' : ''}`}
        onClick={laeuft ? stoppen : starten}
        title={laeuft ? 'Diktat beenden' : titel}
        aria-label={laeuft ? 'Diktat beenden' : titel}
      >
        {laeuft ? '■' : '🎤'}
      </button>
      {laeuft && <span className="diktat-hinweis">Sprechen … (Klick beendet)</span>}
      {fehler && <span className="diktat-fehler">{fehler}</span>}
    </span>
  );
}
