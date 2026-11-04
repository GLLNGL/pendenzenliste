import { useCallback, useEffect, useState } from 'react';
import api from '../api.js';
import PendenzListe from '../components/PendenzListe.jsx';
import PendenzModal from '../components/PendenzModal.jsx';
import MandantModal from '../components/MandantModal.jsx';
import { useMandanten, useMitarbeitende } from '../hooks.js';
import { aufAenderungHoeren, meldeAenderung } from '../events.js';
import { OFFENE_STATUS } from '../constants.js';

const EINGEKLAPPT_SCHLUESSEL = 'mandanten-eingeklappt';

function eingeklapptLesen() {
  try {
    const liste = JSON.parse(localStorage.getItem(EINGEKLAPPT_SCHLUESSEL));
    return new Set(Array.isArray(liste) ? liste : []);
  } catch {
    return new Set();
  }
}

export default function Mandanten() {
  const [eingeklappt, setEingeklappt] = useState(eingeklapptLesen);
  const [uebersicht, setUebersicht] = useState([]);
  const [offenePendenzen, setOffenePendenzen] = useState([]);
  const [fehler, setFehler] = useState(null);
  const [aktivePendenz, setAktivePendenz] = useState(null);
  const [bearbeiteterMandant, setBearbeiteterMandant] = useState(null);
  const [neuerMandantOffen, setNeuerMandantOffen] = useState(false);
  const [zeigeInaktive, setZeigeInaktive] = useState(false);
  const mandanten = useMandanten();
  const mitarbeitende = useMitarbeitende();

  const laden = useCallback(() => {
    Promise.all([
      api.mandanten.uebersicht(),
      api.pendenzen.liste({ status: OFFENE_STATUS.join(','), sort: 'faelligkeit_asc' }),
    ]).then(([u, p]) => {
      setUebersicht(u);
      setOffenePendenzen(p);
    }).catch((e) => setFehler(e.message));
  }, []);

  useEffect(() => {
    laden();
    return aufAenderungHoeren(laden);
  }, [laden]);

  async function statusAendern(pendenz, neuerStatus) {
    await api.pendenzen.statusAendern(pendenz.id, neuerStatus);
    meldeAenderung();
  }

  function eingeklapptSetzen(neu) {
    setEingeklappt(neu);
    try { localStorage.setItem(EINGEKLAPPT_SCHLUESSEL, JSON.stringify([...neu])); } catch { /* ohne Speicher weiter nutzbar */ }
  }

  function toggleMandant(id) {
    const neu = new Set(eingeklappt);
    if (neu.has(id)) neu.delete(id); else neu.add(id);
    eingeklapptSetzen(neu);
  }

  if (fehler) return <div className="fehleranzeige">Fehler beim Laden: {fehler}</div>;

  const sichtbareMandanten = uebersicht.filter((m) => zeigeInaktive || m.aktiv);

  return (
    <div className="mandanten-seite">
      <h1 className="seiten-titel">Mandanten</h1>
      <p className="seiten-untertitel">Offene Pendenzen pro Mandant, gruppiert nach Status.</p>

      <div className="filter-leiste">
        <button type="button" className="btn" onClick={() => setNeuerMandantOffen(true)}>+ Neuer Mandant</button>
        <button type="button" className="btn" onClick={() => eingeklapptSetzen(new Set(sichtbareMandanten.map((m) => m.id)))}>Alle einklappen</button>
        <button type="button" className="btn" onClick={() => eingeklapptSetzen(new Set())}>Alle ausklappen</button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-muted)' }}>
          <input type="checkbox" checked={zeigeInaktive} onChange={(e) => setZeigeInaktive(e.target.checked)} />
          Inaktive Mandanten anzeigen
        </label>
      </div>

      {sichtbareMandanten.map((mandant) => {
        const pendenzenDesMandanten = offenePendenzen.filter((p) => p.mandant_id === mandant.id);
        const istEingeklappt = eingeklappt.has(mandant.id);
        return (
          <div className="karte mandant-karte" key={mandant.id}>
            <div
              className={`mandant-kopf mandant-kopf-klickbar ${istEingeklappt ? 'eingeklappt' : ''}`}
              onClick={() => toggleMandant(mandant.id)}
            >
              <div>
                <button
                  type="button"
                  className="mandant-einklapp-toggle"
                  aria-expanded={!istEingeklappt}
                  aria-label={istEingeklappt ? 'Mandant ausklappen' : 'Mandant einklappen'}
                  onClick={(e) => { e.stopPropagation(); toggleMandant(mandant.id); }}
                >
                  {istEingeklappt ? '▸' : '▾'}
                </button>
                <span className="mandant-name">{mandant.name}</span>
                {mandant.kuerzel && <span className="mandant-kuerzel">{mandant.kuerzel}</span>}
                {!mandant.aktiv && <span className="tag-inaktiv" style={{ marginLeft: 8 }}>INAKTIV</span>}
              </div>
              <div className="mandant-zaehler">
                {mandant.ueberfaellige_pendenzen > 0 && (
                  <span className="zaehler-pille ueberfaellig">{mandant.ueberfaellige_pendenzen} überfällig</span>
                )}
                <span className="zaehler-pille">{mandant.offenTotal} offen</span>
                <button
                  type="button"
                  className="btn-klein"
                  onClick={(e) => { e.stopPropagation(); setBearbeiteterMandant(mandant); }}
                >
                  Bearbeiten
                </button>
              </div>
            </div>

            {!istEingeklappt && (() => {
              let ersteGruppeGezeigt = false;
              return OFFENE_STATUS.map((status) => {
                const gruppe = pendenzenDesMandanten.filter((p) => p.status === status);
                if (!gruppe.length) return null;
                // Nur die erste sichtbare Statusgruppe zeigt den Tabellenkopf -- sonst
                // wiederholt sich "Titel / Mandant / Status / Fällig" pro Mandant mehrfach.
                const mitKopf = !ersteGruppeGezeigt;
                ersteGruppeGezeigt = true;
                return (
                  <div key={status}>
                    <div className="status-gruppe-titel">{status} ({gruppe.length})</div>
                    <PendenzListe pendenzen={gruppe} onOeffnen={setAktivePendenz} onStatusAendern={statusAendern} mitKopf={mitKopf} ohneMandantSpalte />
                  </div>
                );
              });
            })()}

            {pendenzenDesMandanten.length === 0 && <div className="leer-hinweis">Keine offenen Pendenzen.</div>}
          </div>
        );
      })}

      {sichtbareMandanten.length === 0 && <div className="leer-hinweis">Keine Mandanten vorhanden.</div>}

      {aktivePendenz && (
        <PendenzModal
          key={aktivePendenz.id}
          pendenz={aktivePendenz}
          mandanten={mandanten}
          mitarbeitende={mitarbeitende}
          onSchliessen={() => setAktivePendenz(null)}
          onGespeichert={() => setAktivePendenz(null)}
          onGeloescht={() => setAktivePendenz(null)}
        />
      )}

      {bearbeiteterMandant && (
        <MandantModal
          mandant={bearbeiteterMandant}
          onSchliessen={() => setBearbeiteterMandant(null)}
          onGespeichert={() => { setBearbeiteterMandant(null); laden(); }}
        />
      )}

      {neuerMandantOffen && (
        <MandantModal
          mandant={null}
          onSchliessen={() => setNeuerMandantOffen(false)}
          onGespeichert={() => { setNeuerMandantOffen(false); laden(); }}
        />
      )}
    </div>
  );
}
