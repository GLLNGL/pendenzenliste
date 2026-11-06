import { Link, useNavigate } from 'react-router-dom';
import { MODULE } from '../lib/module.js';

// Startseite analog Abacus: alle Module als Kacheln, darin die Programme des Moduls.
export default function Start() {
  const navigate = useNavigate();
  return (
    <div className="start-seite">
      <h1 className="seiten-titel">Module</h1>
      <p className="seiten-untertitel">Modul wählen – die Seitenleiste zeigt danach nur dessen Programme. Oben links im Feld «Modul» wechselst du jederzeit.</p>
      <div className="modul-kacheln">
        {MODULE.map((m) => (
          <div
            key={m.id}
            className={`modul-kachel ${m.folgt ? 'folgt' : ''}`}
            role={m.folgt ? undefined : 'button'}
            tabIndex={m.folgt ? undefined : 0}
            onClick={() => !m.folgt && navigate(m.eintraege[0].pfad)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !m.folgt) navigate(m.eintraege[0].pfad); }}
          >
            <div className="modul-kachel-kopf">
              <span className="modul-kachel-symbol" aria-hidden="true">{m.symbol}</span>
              <span className="modul-kachel-name">{m.nr} {m.name}</span>
              {m.folgt && <span className="tag-potenziell">folgt</span>}
            </div>
            <p className="modul-kachel-text">{m.beschreibung}</p>
            {m.eintraege.length > 0 && (
              <ul className="modul-kachel-programme">
                {m.eintraege.map((e) => (
                  <li key={e.pfad}><Link to={e.pfad} onClick={(ev) => ev.stopPropagation()}>{e.label}</Link></li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
