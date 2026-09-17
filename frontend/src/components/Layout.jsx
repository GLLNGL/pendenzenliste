import { useEffect, useState, useCallback } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import api from '../api.js';
import PendenzModal from './PendenzModal.jsx';
import { aufMandantenAenderungHoeren, aufMitarbeitendeAenderungHoeren } from '../events.js';
import { useAuth } from '../AuthContext.jsx';

const NAV_EINTRAEGE = [
  { pfad: '/', label: 'Cockpit' },
  { pfad: '/pendenzen', label: 'Alle Pendenzen' },
  { pfad: '/mandanten', label: 'Mandanten' },
  { pfad: '/regeln', label: 'Wiederkehr-Regeln' },
  { pfad: '/archiv', label: 'Archiv' },
  { pfad: '/team', label: 'Team' },
  { pfad: '/einstellungen', label: 'Einstellungen' },
];

function editierbaresElementFokussiert() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export default function Layout() {
  const { benutzer, abmelden } = useAuth();
  const [mandanten, setMandanten] = useState([]);
  const [mitarbeitende, setMitarbeitende] = useState([]);
  const [schnellErfassungOffen, setSchnellErfassungOffen] = useState(false);

  const ladeMandanten = useCallback(() => {
    api.mandanten.liste().then(setMandanten).catch(() => {});
  }, []);

  const ladeMitarbeitende = useCallback(() => {
    api.mitarbeitende.liste().then(setMitarbeitende).catch(() => {});
  }, []);

  useEffect(() => {
    ladeMandanten();
    return aufMandantenAenderungHoeren(ladeMandanten);
  }, [ladeMandanten]);

  useEffect(() => {
    ladeMitarbeitende();
    return aufMitarbeitendeAenderungHoeren(ladeMitarbeitende);
  }, [ladeMitarbeitende]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'n' && !editierbaresElementFokussiert() && !schnellErfassungOffen) {
        e.preventDefault();
        setSchnellErfassungOffen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [schnellErfassungOffen]);

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-titel">Pendenzenliste</div>
        <nav className="sidebar-nav">
          {NAV_EINTRAEGE.map((eintrag) => (
            <NavLink key={eintrag.pfad} to={eintrag.pfad} end={eintrag.pfad === '/'} className={({ isActive }) => (isActive ? 'aktiv' : '')}>
              {eintrag.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-fuss">
          <button type="button" className="btn-neu" onClick={() => setSchnellErfassungOffen(true)}>
            <span>+ Neue Pendenz</span>
            <span className="taste">n</span>
          </button>
          {benutzer && (
            <div className="sidebar-benutzer">
              <span className="sidebar-benutzer-name">{benutzer.name}</span>
              <button type="button" className="sidebar-abmelden" onClick={abmelden}>Abmelden</button>
            </div>
          )}
        </div>
      </aside>

      <main className="hauptbereich">
        <Outlet />
      </main>

      {schnellErfassungOffen && (
        <PendenzModal
          pendenz={null}
          mandanten={mandanten}
          mitarbeitende={mitarbeitende}
          onSchliessen={() => setSchnellErfassungOffen(false)}
          onGespeichert={() => setSchnellErfassungOffen(false)}
          onGeloescht={() => setSchnellErfassungOffen(false)}
        />
      )}
    </div>
  );
}
