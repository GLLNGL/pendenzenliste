import { useEffect, useRef, useState } from 'react';

// Allgemeines Bearbeiten-Fenster fuer einfache Datensaetze (Preise, Pauschalen). Felder werden
// beschrieben statt einzeln ausprogrammiert:
//   { name, label, typ: 'text'|'zahl'|'datum'|'select'|'textarea'|'checkbox', optionen: [{wert, label}],
//     pflicht, hinweis, halb (zwei halbe Felder nebeneinander), sichtbar(formular), schritt, vorschlaege }
// vorschau(formular) liefert optional eine berechnete Zeile (z.B. Preis pro Einheit).
// onAendern(name, wert, formular) darf weitere Felder mitsetzen (Rueckgabe: Teil-Objekt).
export default function FormularModal({ titel, felder, startwerte, vorschau, onAendern, onSpeichern, onLoeschen, loeschenText, onSchliessen, speichernText = 'Speichern', breit = false }) {
  const [formular, setFormular] = useState(startwerte);
  const [fehler, setFehler] = useState(null);
  const [beschaeftigt, setBeschaeftigt] = useState(false);
  const ersterRef = useRef(null);

  useEffect(() => { ersterRef.current?.focus(); }, []);

  useEffect(() => {
    function onKeyDown(e) { if (e.key === 'Escape') onSchliessen(); }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSchliessen]);

  function aendern(name, wert) {
    setFormular((f) => {
      const neu = { ...f, [name]: wert };
      return onAendern ? { ...neu, ...(onAendern(name, wert, neu) || {}) } : neu;
    });
  }

  async function ausfuehren(aktion) {
    setBeschaeftigt(true);
    setFehler(null);
    try {
      await aktion();
    } catch (err) {
      setFehler(err.message);
      setBeschaeftigt(false);
    }
  }

  // Beschriftung darf vom Formular abhaengen (z.B. Einheit der gewaehlten Leistung).
  const labelVon = (feld) => (typeof feld.label === 'function' ? feld.label(formular) : feld.label);

  function speichern(e) {
    e.preventDefault();
    // Kann innerhalb eines anderen Formulars (z.B. Pendenz-Fenster) geoeffnet sein -- dessen
    // onSubmit darf nicht mitlaufen.
    e.stopPropagation();
    const fehlend = felder.filter((f) => f.pflicht && (!f.sichtbar || f.sichtbar(formular))
      && (formular[f.name] === '' || formular[f.name] == null));
    if (fehlend.length) { setFehler(`Bitte ausfüllen: ${fehlend.map((f) => labelVon(f)).join(', ')}`); return; }
    ausfuehren(() => onSpeichern(formular));
  }

  function loeschen() {
    if (!window.confirm(loeschenText || 'Wirklich löschen?')) return;
    ausfuehren(onLoeschen);
  }

  // Aufeinanderfolgende halbe Felder paarweise in eine Reihe legen.
  const sichtbare = felder.filter((f) => !f.sichtbar || f.sichtbar(formular));
  const zeilen = [];
  for (const feld of sichtbare) {
    const letzte = zeilen[zeilen.length - 1];
    if (feld.halb && letzte && letzte.length === 1 && letzte[0].halb) letzte.push(feld);
    else zeilen.push([feld]);
  }

  function eingabe(feld, index) {
    const id = `formular-${feld.name}`;
    const wert = formular[feld.name] ?? '';
    const gemeinsam = { id, ref: index === 0 ? ersterRef : undefined };
    if (feld.typ === 'checkbox') {
      return (
        <label className="feld-checkbox" htmlFor={id}>
          <input {...gemeinsam} type="checkbox" checked={!!formular[feld.name]} onChange={(e) => aendern(feld.name, e.target.checked)} />
          {labelVon(feld)}
        </label>
      );
    }
    let element;
    if (feld.typ === 'eigen') {
      // Eigenes Eingabeelement (z.B. Mandanten-Suche): render({ id, wert, setzen, formular })
      element = feld.render({ id, wert: formular[feld.name], setzen: (v) => aendern(feld.name, v), formular });
    } else if (feld.typ === 'select') {
      element = (
        <select {...gemeinsam} value={wert} onChange={(e) => aendern(feld.name, e.target.value)}>
          {feld.leer !== false && <option value="">{feld.leer || '– wählen –'}</option>}
          {feld.optionen.map((o) => <option key={o.wert} value={o.wert}>{o.label}</option>)}
        </select>
      );
    } else if (feld.typ === 'textarea') {
      element = <textarea {...gemeinsam} value={wert} onChange={(e) => aendern(feld.name, e.target.value)} />;
    } else {
      const typ = feld.typ === 'zahl' ? 'number' : feld.typ === 'datum' ? 'date' : feld.typ === 'uhrzeit' ? 'time' : 'text';
      element = (
        <input
          {...gemeinsam}
          type={typ}
          step={feld.typ === 'zahl' ? (feld.schritt ?? 'any') : undefined}
          min={feld.typ === 'zahl' ? 0 : undefined}
          value={wert}
          list={feld.vorschlaege ? `${id}-liste` : undefined}
          placeholder={feld.platzhalter}
          onChange={(e) => aendern(feld.name, e.target.value)}
        />
      );
    }
    return (
      <>
        <label htmlFor={id}>{labelVon(feld)}{feld.pflicht ? ' *' : ''}</label>
        {element}
        {feld.vorschlaege && (
          <datalist id={`${id}-liste`}>{feld.vorschlaege.map((v) => <option key={v} value={v} />)}</datalist>
        )}
        {feld.hinweis && <p className="feld-hinweis">{feld.hinweis}</p>}
      </>
    );
  }

  let index = 0;
  const vorschauText = vorschau?.(formular);

  return (
    <div className="modal-hintergrund" onClick={onSchliessen}>
      <div className={`modal ${breit ? 'modal-mittel' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-kopf">
          <span>{titel}</span>
          <button type="button" className="modal-schliessen" onClick={onSchliessen} aria-label="Schliessen">×</button>
        </div>
        <form onSubmit={speichern}>
          <div className="modal-koerper">
            {zeilen.map((zeile) => (
              zeile.length === 2 ? (
                <div className="feld-reihe" key={zeile[0].name}>
                  {zeile.map((f) => <div className="feld" key={f.name}>{eingabe(f, index++)}</div>)}
                </div>
              ) : (
                <div className="feld" key={zeile[0].name}>{eingabe(zeile[0], index++)}</div>
              )
            ))}
            {vorschauText && <div className="formular-vorschau">{vorschauText}</div>}
            {fehler && <div className="hinweis-fehler">{fehler}</div>}
          </div>
          <div className="modal-fuss">
            <div>
              {onLoeschen && <button type="button" className="btn btn-gefahr" onClick={loeschen} disabled={beschaeftigt}>Löschen</button>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn" onClick={onSchliessen}>Abbrechen</button>
              <button type="submit" className="btn btn-primary" disabled={beschaeftigt}>{beschaeftigt ? 'Bitte warten…' : speichernText}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
