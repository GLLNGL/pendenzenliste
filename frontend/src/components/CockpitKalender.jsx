import { useEffect, useMemo, useState } from 'react';
import api from '../api.js';
import { formatiereDatum } from '../format.js';
import { formatiereAufwand } from '../constants.js';
import { monatsRaster, monatVerschieben, monatName, pendenzenAm, termineAm, tagesMarken, zeitText, plusTage } from '../lib/kalenderMonat.js';

const WOCHENTAGE = ['MO', 'DI', 'MI', 'DO', 'FR', 'SA', 'SO'];
const WOCHENTAG_LANG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

function tagUeberschrift(tag, heute) {
  if (tag === heute) return 'Heute';
  if (tag === plusTage(heute, 1)) return 'Morgen';
  const [j, m, t] = tag.split('-').map(Number);
  return `${WOCHENTAG_LANG[new Date(Date.UTC(j, m - 1, t)).getUTCDay()]}, ${formatiereDatum(tag)}`;
}

// Rechte Spalte im Cockpit, aufgebaut wie die Aufgabenleiste in Outlook: Monatskalender, darunter
// fuer den angeklickten Tag die Outlook-Termine und die an diesem Tag geplanten Pendenzen.
export default function CockpitKalender({ offene, heute, onOeffnen }) {
  const [monat, setMonat] = useState(heute.slice(0, 7));
  const [tag, setTag] = useState(heute);
  const [termine, setTermine] = useState([]);
  const [outlook, setOutlook] = useState('laedt');
  const raster = useMemo(() => monatsRaster(monat), [monat]);

  useEffect(() => {
    let aktiv = true;
    const von = raster[0].tag;
    const bis = plusTage(raster[raster.length - 1].tag, 1);
    const holen = () => api.outlook.termine(von, bis)
      .then((t) => { if (aktiv) { setTermine(t); setOutlook('ok'); } })
      .catch((e) => { if (aktiv) setOutlook(e.message); });
    holen();
    // Alle 5 Minuten nachladen, damit neue Outlook-Termine ohne Neuladen erscheinen.
    const uhr = setInterval(holen, 5 * 60 * 1000);
    return () => { aktiv = false; clearInterval(uhr); };
  }, [raster]);

  const marken = useMemo(() => tagesMarken(raster, termine, offene), [raster, termine, offene]);
  const tagesTermine = termineAm(termine, tag);
  const tagesPendenzen = pendenzenAm(offene, tag);

  function waehlen(t) {
    setTag(t);
    if (t.slice(0, 7) !== monat) setMonat(t.slice(0, 7));
  }

  return (
    <aside className="ck-leiste" aria-label="Kalender">
      <div className="ck-monat">
        <div className="ck-monat-kopf">
          <button type="button" onClick={() => setMonat(monatVerschieben(monat, -1))} aria-label="Vorheriger Monat">‹</button>
          <button type="button" className="ck-monat-name" onClick={() => { setMonat(heute.slice(0, 7)); setTag(heute); }} title="Zu heute">{monatName(monat)}</button>
          <button type="button" onClick={() => setMonat(monatVerschieben(monat, 1))} aria-label="Nächster Monat">›</button>
        </div>
        <div className="ck-raster" role="grid">
          {WOCHENTAGE.map((w) => <div key={w} className="ck-wochentag">{w}</div>)}
          {raster.map((r) => {
            const m = marken.get(r.tag);
            const klassen = ['ck-tag', r.imMonat ? '' : 'fremd', r.tag === heute ? 'heute' : '', r.tag === tag ? 'gewaehlt' : '',
              m?.termine ? 'mit-termin' : ''].filter(Boolean).join(' ');
            const titel = [m?.termine ? `${m.termine} Termin${m.termine === 1 ? '' : 'e'}` : '', m?.pendenzen ? `${m.pendenzen} Pendenz${m.pendenzen === 1 ? '' : 'en'}` : ''].filter(Boolean).join(' · ');
            return (
              <button key={r.tag} type="button" className={klassen} onClick={() => waehlen(r.tag)} title={titel || undefined} aria-pressed={r.tag === tag}>
                {r.nummer}
                {m?.pendenzen > 0 && <span className="ck-punkt" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>

      <section className="ck-tagesbereich">
        <h3 className="ck-ueberschrift">{tagUeberschrift(tag, heute)}</h3>
        {outlook === 'DIENST_AUS' && (
          <div className="ck-hinweis">Outlook-Termine: Der Outlook-Dienst auf diesem PC läuft nicht. «Pendenzenliste-starten» ausführen (auf dem Handy gibt es keine Outlook-Termine).</div>
        )}
        {outlook !== 'ok' && outlook !== 'laedt' && outlook !== 'DIENST_AUS' && <div className="ck-hinweis ck-fehler">Outlook: {outlook}</div>}
        {outlook === 'laedt' && <div className="ck-hinweis">Termine werden aus Outlook geladen…</div>}
        {outlook === 'ok' && tagesTermine.length === 0 && <div className="ck-leer">Keine Termine in Outlook.</div>}
        {tagesTermine.length > 0 && (
          <ul className="ck-termine">
            {tagesTermine.map((t, i) => (
              <li key={`${t.start}-${i}`} className={`ck-termin ${t.frei ? 'frei' : ''}`}>
                <span className="ck-termin-zeit">{zeitText(t, tag)}</span>
                <span className="ck-termin-text">
                  <span className="ck-termin-betreff">{t.betreff || '(ohne Betreff)'}</span>
                  {t.ort && <span className="ck-termin-ort">{t.ort}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ck-tagesbereich">
        <h3 className="ck-ueberschrift">Geplante Pendenzen <span className="ck-anzahl">{tagesPendenzen.length}</span></h3>
        {tagesPendenzen.length === 0 && <div className="ck-leer">An diesem Tag ist nichts geplant.</div>}
        <ul className="ck-pendenzen">
          {tagesPendenzen.map((p) => (
            <li key={p.id}>
              <button type="button" className={`ck-pendenz ${p.status === 'Warten auf' ? 'warten' : ''}`} onClick={() => onOeffnen(p)}>
                <span className="ck-pendenz-titel">{p.titel}</span>
                <span className="ck-pendenz-info">
                  {[p.mandant_name || 'Intern', p.eltern_titel, p.status === 'Warten auf' ? `nachfassen bei ${p.warten_auf_person || '–'}` : null,
                    p.aufwand_minuten ? formatiereAufwand(p.aufwand_minuten) : null].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
