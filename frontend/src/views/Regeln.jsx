import { useCallback, useEffect, useState } from 'react';
import api from '../api.js';
import RegelModal from '../components/RegelModal.jsx';
import { useMandanten } from '../hooks.js';
import { formatiereDatum } from '../format.js';

const RHYTHMUS_LABEL = { monatlich: 'Monatlich', quartalsweise: 'Quartalsweise', halbjaehrlich: 'Halbjährlich', jaehrlich: 'Jährlich' };

export default function Regeln() {
  const [regeln, setRegeln] = useState([]);
  const [vorschauen, setVorschauen] = useState({});
  const [meta, setMeta] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [bearbeiteteRegel, setBearbeiteteRegel] = useState(null);
  const [neueRegelOffen, setNeueRegelOffen] = useState(false);
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
    if (!id) return 'Intern (kein Mandant)';
    return mandanten.find((m) => m.id === id)?.name ?? `Mandant #${id}`;
  }

  if (fehler) return <div className="fehleranzeige">Fehler beim Laden: {fehler}</div>;

  return (
    <div>
      <h1 className="seiten-titel">Wiederkehr-Regeln</h1>
      <p className="seiten-untertitel">Vorlagen für automatisch erzeugte Pendenzen (MWST, Lohnläufe, Zahlungsläufe, Jahresabschlüsse …).</p>

      <div className="filter-leiste">
        <button type="button" className="btn" onClick={() => setNeueRegelOffen(true)} disabled={!meta}>+ Neue Regel</button>
      </div>

      <div className="karte">
        <table className="tabelle">
          <thead>
            <tr>
              <th>Titel-Vorlage</th>
              <th>Mandant</th>
              <th>Rhythmus</th>
              <th>Vorlauf</th>
              <th>Nächste 3 Pendenzen</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {regeln.map((regel) => (
              <tr key={regel.id} style={!regel.aktiv ? { opacity: 0.55 } : undefined}>
                <td>
                  {regel.titel_vorlage}
                  {!regel.aktiv && <div className="tag-inaktiv">INAKTIV</div>}
                </td>
                <td>{mandantName(regel.mandant_id)}</td>
                <td>{RHYTHMUS_LABEL[regel.rhythmus] || regel.rhythmus}</td>
                <td>{regel.vorlauf_tage} Tage</td>
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
              <tr><td colSpan={6} className="leer-hinweis">Keine Wiederkehr-Regeln vorhanden.</td></tr>
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
