import { useCallback, useEffect, useState } from 'react';
import api from '../api.js';
import RegelModal from '../components/RegelModal.jsx';
import { useMandanten } from '../hooks.js';
import { formatiereDatum, heutigesDatumISO } from '../format.js';
import { RHYTHMUS_LABEL } from '../constants.js';
import { meldeAenderung } from '../events.js';
import { naechsteWoche } from '../lib/cockpit.js';

function vorlaufText(regel) {
  return `${regel.vorlauf_tage} ${regel.vorlauf_einheit === 'arbeitstage' ? 'Arbeitstage' : 'Tage'}`;
}

export default function Regeln() {
  const [regeln, setRegeln] = useState([]);
  const [vorschauen, setVorschauen] = useState({});
  const [meta, setMeta] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [bearbeiteteRegel, setBearbeiteteRegel] = useState(null);
  const [neueRegelOffen, setNeueRegelOffen] = useState(false);
  const [erzeugtGerade, setErzeugtGerade] = useState(false);
  const [ergebnis, setErgebnis] = useState(null);
  const mandanten = useMandanten();

  const laden = useCallback(() => {
    api.regeln.liste().then(async (liste) => {
      setRegeln(liste);
      const eintraege = await Promise.all(liste.map(async (r) => [r.id, await api.regeln.vorschau(r.id, 3)]));
      setVorschauen(Object.fromEntries(eintraege));
    }).catch((e) => setFehler(e.message));
  }, []);

  useEffect(() => { laden(); }, [laden]);
  useEffect(() => { api.meta().then(setMeta).catch((e) => setFehler(e.message)); }, []);

  function mandantName(id) {
    if (!id) return 'Intern (eigenes Büro)';
    return mandanten.find((m) => m.id === id)?.name ?? `Mandant #${id}`;
  }

  // "Wiederkehrende für nächste Woche erzeugen": alles, was bis Freitag der kommenden Woche
  // erscheint (Fälligkeit minus Vorlauf), ohne Duplikate.
  async function naechsteWocheErzeugen() {
    const { bis } = naechsteWoche(heutigesDatumISO());
    setErzeugtGerade(true);
    setErgebnis(null);
    try {
      const neu = await api.regeln.erzeugen(bis);
      meldeAenderung();
      setErgebnis({ bis, neu });
    } catch (err) {
      setErgebnis({ bis, fehler: err.message });
    } finally {
      setErzeugtGerade(false);
    }
  }

  if (fehler) return <div className="fehleranzeige">Fehler beim Laden: {fehler}</div>;

  return (
    <div>
      <h1 className="seiten-titel">Wiederkehrende Arbeiten</h1>
      <p className="seiten-untertitel">
        Zahlungsläufe, Lohnläufe, MWST, Mahnläufe, Jahresabschlüsse … Fällige Pendenzen entstehen automatisch mit ihrem Vorlauf
        (täglich beim Öffnen der App); die Checkliste wird als Projekt-Schritte angelegt.
      </p>

      <div className="filter-leiste">
        <button type="button" className="btn" onClick={() => setNeueRegelOffen(true)} disabled={!meta}>+ Neue wiederkehrende Arbeit</button>
        <button type="button" className="btn btn-primary" onClick={naechsteWocheErzeugen} disabled={erzeugtGerade}>
          {erzeugtGerade ? 'Erzeuge…' : 'Wiederkehrende für nächste Woche erzeugen'}
        </button>
      </div>

      {ergebnis && (
        <div className={ergebnis.fehler ? 'hinweis-fehler' : 'hinweis-erfolg'} style={{ marginBottom: 12, maxWidth: 900 }}>
          {ergebnis.fehler && `Fehler beim Erzeugen: ${ergebnis.fehler}`}
          {!ergebnis.fehler && ergebnis.neu.length === 0 && `Alles bereits vorhanden – bis ${formatiereDatum(ergebnis.bis)} ist nichts Neues fällig.`}
          {!ergebnis.fehler && ergebnis.neu.length > 0 && (
            <>
              {ergebnis.neu.length} Pendenz{ergebnis.neu.length === 1 ? '' : 'en'} erzeugt (bis {formatiereDatum(ergebnis.bis)}):
              <ul className="vorschau-liste">
                {ergebnis.neu.map((p) => (
                  <li key={p.id}>{p.titel} – fällig {formatiereDatum(p.faelligkeit)}{p.schritte ? ` (${p.schritte} Schritte)` : ''}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="karte">
        <table className="tabelle">
          <thead>
            <tr>
              <th>Typ</th>
              <th>Titel-Vorlage</th>
              <th>Mandant</th>
              <th>Rhythmus</th>
              <th>Vorlauf</th>
              <th>Block</th>
              <th>Checkliste</th>
              <th>Nächste 3</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {regeln.map((regel) => (
              <tr key={regel.id} style={!regel.aktiv ? { opacity: 0.55 } : undefined}>
                <td>{regel.typ}</td>
                <td>
                  {regel.titel_vorlage}
                  {!regel.aktiv && <div className="tag-inaktiv">INAKTIV</div>}
                </td>
                <td>{mandantName(regel.mandant_id)}</td>
                <td>{RHYTHMUS_LABEL[regel.rhythmus] || regel.rhythmus}</td>
                <td>{vorlaufText(regel)}</td>
                <td>{regel.block}</td>
                <td>{regel.checkliste?.length ? `${regel.checkliste.length} Schritte` : '–'}</td>
                <td>
                  <ul className="vorschau-liste">
                    {(vorschauen[regel.id] || []).map((v) => (
                      <li key={v.periodenSchluessel}>{v.titel} – {formatiereDatum(v.faelligkeit)}</li>
                    ))}
                  </ul>
                </td>
                <td className="spalte-aktionen">
                  <button type="button" className="btn-klein" onClick={() => setBearbeiteteRegel(regel)}>Bearbeiten</button>
                </td>
              </tr>
            ))}
            {regeln.length === 0 && (
              <tr><td colSpan={9} className="leer-hinweis">Noch keine wiederkehrenden Arbeiten erfasst.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {bearbeiteteRegel && meta && (
        <RegelModal
          regel={bearbeiteteRegel}
          mandanten={mandanten}
          faelligkeitTypen={meta.faelligkeitTypen}
          rhythmen={meta.rhythmen}
          onSchliessen={() => setBearbeiteteRegel(null)}
          onGespeichert={() => { setBearbeiteteRegel(null); laden(); }}
          onGeloescht={() => { setBearbeiteteRegel(null); laden(); }}
        />
      )}

      {neueRegelOffen && meta && (
        <RegelModal
          regel={null}
          mandanten={mandanten}
          faelligkeitTypen={meta.faelligkeitTypen}
          rhythmen={meta.rhythmen}
          onSchliessen={() => setNeueRegelOffen(false)}
          onGespeichert={() => { setNeueRegelOffen(false); laden(); }}
          onGeloescht={() => setNeueRegelOffen(false)}
        />
      )}
    </div>
  );
}
