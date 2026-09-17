import { useState } from 'react';
import { useAuth } from '../AuthContext.jsx';
import MobilErfassen from './MobilErfassen.jsx';
import MobilKalender from './MobilKalender.jsx';

// Eigene, bewusst schmale Ansicht fuers Handy: keine Sidebar mit sieben Menuepunkten, keine
// Mandanten-/Team-/Regeln-Verwaltung -- nur die zwei Dinge, die unterwegs gebraucht werden:
// schnell etwas erfassen und zur Planung in den Kalender schauen. Die volle Ansicht bleibt am
// Buero-PC (App.jsx entscheidet anhand der Fensterbreite, welche der beiden gezeigt wird).
export default function MobilApp() {
  const [tab, setTab] = useState('erfassen');
  const { abmelden } = useAuth();

  return (
    <div className="mobil-app">
      <header className="mobil-kopf">
        <nav className="mobil-tabs">
          <button type="button" className={tab === 'erfassen' ? 'aktiv' : ''} onClick={() => setTab('erfassen')}>
            + Erfassen
          </button>
          <button type="button" className={tab === 'kalender' ? 'aktiv' : ''} onClick={() => setTab('kalender')}>
            Kalender
          </button>
        </nav>
        <button type="button" className="mobil-abmelden" onClick={abmelden} aria-label="Abmelden">⏻</button>
      </header>

      <main className="mobil-hauptbereich">
        {tab === 'erfassen' ? <MobilErfassen /> : <MobilKalender />}
      </main>
    </div>
  );
}
