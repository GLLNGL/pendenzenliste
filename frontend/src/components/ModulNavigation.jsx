import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { MODULE, modulFuerPfad, passt } from '../lib/module.js';

const ZU_SCHLUESSEL = 'navigation-gruppen-zu';

function zuLesen() {
  try { return new Set(JSON.parse(localStorage.getItem(ZU_SCHLUESSEL) || '[]')); } catch { return new Set(); }
}

function Chevron({ offen }) {
  return <span className={`modul-chevron ${offen ? 'offen' : ''}`} aria-hidden="true">›</span>;
}

// Seitenleiste analog Abacus: Feld "Modul" mit Aufklappliste (Tippen filtert), darunter der
// Programmbaum des Moduls -- Gruppen einklappbar, Programmnummern rechts.
export default function ModulNavigation({ zaehler = {} }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const modul = modulFuerPfad(pathname);
  const [offen, setOffen] = useState(false);
  const [text, setText] = useState('');
  const [markiert, setMarkiert] = useState(0);
  const [zu, setZu] = useState(zuLesen);
  const boxRef = useRef(null);
  const eingabeRef = useRef(null);

  const t = text.trim().toLowerCase();
  const treffer = MODULE.filter((m) => !t || `${m.nr} ${m.name}`.toLowerCase().includes(t));

  useEffect(() => {
    if (!offen) return undefined;
    eingabeRef.current?.focus();
    function aussen(e) { if (!boxRef.current?.contains(e.target)) setOffen(false); }
    document.addEventListener('mousedown', aussen);
    return () => document.removeEventListener('mousedown', aussen);
  }, [offen]);

  function waehlen(m) {
    setOffen(false);
    setText('');
    navigate(m.eintraege[0].pfad);
  }
  function taste(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setMarkiert((i) => Math.min(i + 1, treffer.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setMarkiert((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (treffer[markiert]) waehlen(treffer[markiert]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOffen(false); }
  }
  function gruppeUmschalten(schluessel) {
    setZu((alt) => {
      const neu = new Set(alt);
      if (neu.has(schluessel)) neu.delete(schluessel); else neu.add(schluessel);
      try { localStorage.setItem(ZU_SCHLUESSEL, JSON.stringify([...neu])); } catch { /* ohne Speicher weiter */ }
      return neu;
    });
  }

  return (
    <div className="modul-navigation">
      <div className="modul-auswahl-label">Modul</div>
      <div className="modul-auswahl" ref={boxRef}>
        {offen ? (
          <div className="modul-auswahl-feld offen">
            <span className="modul-auswahl-symbol" aria-hidden="true">◫</span>
            <input
              ref={eingabeRef}
              value={text}
              placeholder={modul ? `${modul.nr} ${modul.name}` : 'Modul suchen'}
              onChange={(e) => { setText(e.target.value); setMarkiert(0); }}
              onKeyDown={taste}
              aria-label="Modul suchen"
            />
            <button type="button" className="modul-auswahl-pfeil" onClick={() => setOffen(false)} aria-label="Schliessen"><Chevron offen /></button>
          </div>
        ) : (
          <button type="button" className="modul-auswahl-feld" onClick={() => { setOffen(true); setMarkiert(Math.max(0, MODULE.indexOf(modul))); }}>
            <span className="modul-auswahl-symbol" aria-hidden="true">◫</span>
            <span className="modul-auswahl-name">{modul ? `${modul.nr} ${modul.name}` : 'Modul wählen'}</span>
            <span className="modul-auswahl-pfeil"><Chevron /></span>
          </button>
        )}
        {offen && (
          <div className="modul-auswahl-liste" role="listbox">
            {treffer.map((m, i) => (
              <button
                type="button"
                key={m.id}
                role="option"
                aria-selected={m === modul}
                className={`modul-auswahl-eintrag ${i === markiert ? 'markiert' : ''} ${m === modul ? 'aktuell' : ''}`}
                onMouseEnter={() => setMarkiert(i)}
                onClick={() => waehlen(m)}
              >
                {m.nr} {m.name}
              </button>
            ))}
            {treffer.length === 0 && <div className="modul-auswahl-leer">Kein Modul gefunden.</div>}
            <Link to="/start" className="modul-auswahl-kacheln" onClick={() => setOffen(false)}>Alle Module als Übersicht</Link>
          </div>
        )}
      </div>

      {modul && (
        <nav className="modul-baum">
          <button type="button" className="modul-baum-modul" onClick={() => gruppeUmschalten(modul.id)}>
            <Chevron offen={!zu.has(modul.id)} />
            <span>{modul.name}</span>
          </button>
          {!zu.has(modul.id) && modul.gruppen.map((g) => {
            const schluessel = `${modul.id}-${g.nr}`;
            const gruppeOffen = !zu.has(schluessel);
            return (
              <div key={schluessel} className="modul-baum-gruppe">
                <button type="button" className="modul-baum-gruppenkopf" onClick={() => gruppeUmschalten(schluessel)}>
                  <Chevron offen={gruppeOffen} />
                  <span className="modul-baum-text">{g.name}</span>
                  <span className="modul-baum-nr">{g.nr}</span>
                </button>
                {gruppeOffen && g.eintraege.map((e) => (
                  <Link
                    key={e.pfad}
                    to={e.pfad}
                    className={`modul-baum-programm ${passt(pathname, e.pfad) ? 'aktiv' : ''}`}
                  >
                    <span className="modul-baum-text">{e.label}</span>
                    {zaehler[e.pfad] > 0 && <span className="zaehler-pille nav-eingang-pille">{zaehler[e.pfad]}</span>}
                    <span className="modul-baum-nr">{e.nr}</span>
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
      )}
    </div>
  );
}
