import { useEffect, useRef, useState } from 'react';
import { hintergrundSchliessen } from '../lib/modal.js';

// Treffer fuer die Suche: zuerst Namen, die mit dem Text beginnen, dann Namen, in denen ein
// Wort damit beginnt (z.B. «per» -> «A4 Personal AG»), dann Kuerzel/Kunden-Nr./Ort, die damit
// beginnen. Leerer Text = alle.
function mandantenFiltern(mandanten, text) {
  const t = text.trim().toLowerCase();
  const sortiert = [...mandanten].sort((a, b) => a.name.localeCompare(b.name, 'de-CH'));
  if (!t) return sortiert;
  const woerter = (s) => String(s).toLowerCase().split(/[\s\-/&.,()]+/).filter(Boolean);
  const beginnt = sortiert.filter((m) => m.name.toLowerCase().startsWith(t));
  const wort = sortiert.filter((m) => !beginnt.includes(m) && woerter(m.name).some((w) => w.startsWith(t)));
  const weitere = sortiert.filter((m) => !beginnt.includes(m) && !wort.includes(m)
    && [m.kuerzel, m.kunden_nr, m.ort].filter(Boolean).some((f) => f.toLowerCase().startsWith(t)));
  return [...beginnt, ...wort, ...weitere];
}

// Feld mit Such-Popup: Klick oeffnet alle aktiven Mandanten, Tippen filtert sofort,
// Pfeiltasten + Enter waehlen.
export default function MandantSuche({ id, mandanten, wert, onWahl, onNeu, leerText = '– Mandant wählen –' }) {
  const [offen, setOffen] = useState(false);
  const [text, setText] = useState('');
  const [markiert, setMarkiert] = useState(0);
  const eingabeRef = useRef(null);
  const listeRef = useRef(null);
  const gewaehlt = mandanten.find((m) => String(m.id) === String(wert));
  const auswahl = mandanten.filter((m) => m.aktiv || String(m.id) === String(wert));
  const treffer = mandantenFiltern(auswahl, text);

  useEffect(() => { if (offen) eingabeRef.current?.focus(); }, [offen]);
  useEffect(() => {
    listeRef.current?.querySelector('.mandant-suche-treffer.markiert')?.scrollIntoView({ block: 'nearest' });
  }, [markiert]);

  function oeffnen() {
    setText('');
    setMarkiert(0);
    setOffen(true);
  }
  function waehlen(m) {
    onWahl(String(m.id));
    setOffen(false);
  }
  function taste(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setMarkiert((i) => Math.min(i + 1, treffer.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setMarkiert((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (treffer[markiert]) waehlen(treffer[markiert]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOffen(false); }
  }

  return (
    <>
      <button type="button" id={id} className="mandant-suche-feld" onClick={oeffnen}>
        <span className={gewaehlt ? '' : 'mandant-suche-leer'}>
          {gewaehlt ? gewaehlt.name : leerText}
          {gewaehlt?.potenziell && <> <span className="tag-potenziell">pot.</span></>}
        </span>
        <span aria-hidden="true">🔍</span>
      </button>
      {offen && (
        <div className="modal-hintergrund" {...hintergrundSchliessen(() => setOffen(false))}>
          <div className="modal mandant-suche-popup" onClick={(e) => e.stopPropagation()} onKeyDown={taste}>
            <div className="modal-kopf">
              <span>Mandant suchen</span>
              <button type="button" className="modal-schliessen" onClick={() => setOffen(false)} aria-label="Schliessen">×</button>
            </div>
            <div className="mandant-suche-eingabe">
              <input
                ref={eingabeRef}
                type="search"
                placeholder="Name, Kürzel, Kunden-Nr. oder Ort eingeben…"
                value={text}
                onChange={(e) => { setText(e.target.value); setMarkiert(0); }}
              />
              <span className="mandant-suche-anzahl">{treffer.length} von {auswahl.length}</span>
            </div>
            <div className="mandant-suche-liste" ref={listeRef}>
              {treffer.map((m, i) => (
                <button
                  type="button"
                  key={m.id}
                  className={`mandant-suche-treffer ${i === markiert ? 'markiert' : ''} ${String(m.id) === String(wert) ? 'gewaehlt' : ''}`}
                  onClick={() => waehlen(m)}
                  onMouseEnter={() => setMarkiert(i)}
                >
                  <span className="mandant-suche-name">
                    {m.name}
                    {m.potenziell && <> <span className="tag-potenziell">pot.</span></>}
                  </span>
                  <span className="mandant-suche-zusatz">{[m.kunden_nr, m.ort].filter(Boolean).join(' · ')}</span>
                </button>
              ))}
              {treffer.length === 0 && <div className="leer-hinweis">Kein Mandant gefunden.</div>}
            </div>
            {onNeu && (
              <div className="modal-fuss">
                <div />
                <button type="button" className="btn" onClick={() => { setOffen(false); onNeu(text); }}>+ Neuer Interessent{text.trim() ? ` «${text.trim()}»` : ''}</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

