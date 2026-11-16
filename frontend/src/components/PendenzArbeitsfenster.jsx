import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api.js';
import ZeitModal from './ZeitModal.jsx';
import DateienListe from './DateienListe.jsx';
import AblageKnoepfe from './AblageKnoepfe.jsx';
import DiktatKnopf from './DiktatKnopf.jsx';
import { textAnhaengen } from '../lib/diktat.js';
import { useLaufenderTimer, timerStarten } from '../lib/timer.js';
import { aufAenderungHoeren, aufZeitAenderungHoeren, meldeAenderung } from '../events.js';
import { STATUS_WERTE, formatiereAufwand, statusSlug } from '../constants.js';
import { formatiereDatum, formatiereZeitstempel, heutigesDatumISO } from '../format.js';
import { formatiereDauer, laufendeMinuten, uhrzeitAus, zusammenfassung, artLabel, betragExtra } from '../lib/zeit.js';
import { ladeICSHerunter } from '../lib/ics.js';
import { hintergrundSchliessen } from '../lib/modal.js';
import { chf } from '../lib/offerte.js';
import { useLeistungen } from '../hooks.js';

const stunden = (min) => (min >= 60 ? `${(min / 60).toLocaleString('de-CH', { maximumFractionDigits: 1 })} h` : `${Math.round(min || 0)} Min.`);

function TimerKnopf({ pendenz, timer, gross = false, onFehler, onStopp }) {
  const laeuftHier = timer && timer.pendenz_id === pendenz.id;
  if (laeuftHier) {
    return (
      <button type="button" className={`aw-timer aw-timer-laeuft ${gross ? 'aw-timer-gross' : ''}`} onClick={(e) => { e.stopPropagation(); onStopp(timer); }} title="Stoppen und Zeit speichern">
        <span className="aw-timer-punkt" />■ {formatiereDauer(laufendeMinuten(timer.timer_start))}{gross ? ' · Stopp' : ''}
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`aw-timer ${gross ? 'aw-timer-gross' : ''}`}
      title={timer ? 'Startet hier – der laufende Timer wird gestoppt und gespeichert.' : 'Zeit für diesen Schritt messen'}
      onClick={async (e) => { e.stopPropagation(); try { await timerStarten(pendenz); } catch (err) { onFehler(err.message); } }}
    >
      ▶{gross ? ' Start' : ''}
    </button>
  );
}

// Arbeitsfenster einer Pendenz bzw. eines Projekts: oben das Wichtigste und der Timer, links
// die Schritte (je mit eigenem Timer), Beschreibung und Verlauf, rechts Zeit und Details.
// «Bearbeiten» oeffnet das bisherige Formular.
export default function PendenzArbeitsfenster({ pendenz: start, mandanten = [], mitarbeitende = [], onSchliessen, onBearbeiten, onGeloescht }) {
  const [pendenz, setPendenz] = useState(start);
  const [schritte, setSchritte] = useState([]);
  const [zeiten, setZeiten] = useState([]);
  const [notizen, setNotizen] = useState([]);
  const [neueNotiz, setNeueNotiz] = useState('');
  const [neuerSchritt, setNeuerSchritt] = useState('');
  const [zeitOffen, setZeitOffen] = useState(null); // { eintrag } | { neu: pendenz }
  const [fehler, setFehler] = useState(null);
  const [beschreibungLang, setBeschreibungLang] = useState(false);
  const timer = useLaufenderTimer();
  const navigate = useNavigate();
  const leistungen = useLeistungen();
  const notizRef = useRef(null);

  const istProjekt = !pendenz.uebergeordnete_pendenz_id;
  const mandant = mandanten.find((m) => m.id === pendenz.mandant_id) ?? null;
  const bearbeiter = mitarbeitende.find((m) => m.id === pendenz.bearbeiter_id) ?? null;
  const heute = heutigesDatumISO();

  const laden = useCallback(async () => {
    try {
      const [p, s, n] = await Promise.all([
        api.pendenzen.holen(start.id),
        istProjekt ? api.pendenzen.teilaufgaben(start.id) : Promise.resolve([]),
        api.pendenzen.notizen(start.id),
      ]);
      setPendenz(p); setSchritte(s); setNotizen(n);
      setZeiten(await api.zeit.liste({ pendenzIds: [start.id, ...s.map((x) => x.id)] }));
    } catch (e) { setFehler(e.message); }
  }, [start.id, istProjekt]);
  useEffect(() => {
    laden();
    const a = aufAenderungHoeren(laden);
    const b = aufZeitAenderungHoeren(laden);
    return () => { a(); b(); };
  }, [laden]);

  useEffect(() => {
    function onKeyDown(e) { if (e.key === 'Escape' && !zeitOffen) onSchliessen(); }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSchliessen, zeitOffen]);

  async function tun(fn) {
    setFehler(null);
    try { await fn(); meldeAenderung(); await laden(); } catch (e) { setFehler(e.message); }
  }
  const statusSetzen = (p, status) => tun(() => api.pendenzen.statusAendern(p.id, status));
  const schrittHinzufuegen = () => tun(async () => {
    const titel = neuerSchritt.trim();
    if (!titel) return;
    await api.pendenzen.erstellen({
      titel, mandantId: pendenz.mandant_id, bearbeiterId: pendenz.bearbeiter_id, prioritaet: pendenz.prioritaet,
      faelligkeit: pendenz.faelligkeit, block: pendenz.block, verrechnung: pendenz.verrechnung,
      uebergeordnetePendenzId: pendenz.id, reihenfolge: (schritte.at(-1)?.reihenfolge ?? schritte.length) + 1,
      status: schritte.some((s) => s.status !== 'Erledigt') ? 'Später' : 'Offen',
    });
    setNeuerSchritt('');
  });
  const notizHinzufuegen = () => tun(async () => {
    if (!neueNotiz.trim()) return;
    await api.pendenzen.notizErstellen(pendenz.id, neueNotiz.trim());
    setNeueNotiz('');
  });
  const loeschen = () => tun(async () => {
    if (!window.confirm(`«${pendenz.titel}» löschen?${schritte.length ? ` Die ${schritte.length} Schritte werden mitgelöscht.` : ''}`)) return;
    await api.pendenzen.loeschen(pendenz.id);
    onGeloescht?.();
    onSchliessen();
  });

  // Zeit: erfasst (inkl. Schritte) gegen geschaetzt.
  const fertig = zeiten.filter((z) => z.minuten != null);
  const summe = zusammenfassung(fertig);
  const geschaetzt = istProjekt && schritte.length
    ? schritte.reduce((s, x) => s + (x.aufwand_minuten || 0), 0)
    : pendenz.aufwand_minuten || 0;
  const anteil = geschaetzt ? summe.gesamt / geschaetzt : null;
  const extraOffen = fertig.filter((z) => z.art === 'extra' && !z.rapport_id).reduce((s, z) => s + (betragExtra(z) ?? 0), 0);
  const offeneZeit = fertig.filter((z) => !z.rapport_id && z.mandant_id && z.art !== 'intern');
  const rapportieren = () => {
    const von = offeneZeit.reduce((min, z) => (z.datum < min ? z.datum : min), heute);
    onSchliessen();
    navigate(`/rapporte/neu?mandant=${pendenz.mandant_id}&von=${von}&bis=${heute}`);
  };
  const zeitProSchritt = new Map();
  for (const z of fertig) zeitProSchritt.set(z.pendenz_id, (zeitProSchritt.get(z.pendenz_id) ?? 0) + z.minuten);

  const erledigt = schritte.filter((s) => s.status === 'Erledigt').length;
  const fristUeber = pendenz.faelligkeit && pendenz.faelligkeit < heute && pendenz.status !== 'Erledigt';
  const beschreibung = pendenz.beschreibung ?? '';
  const beschreibungKurz = beschreibung.length > 420 && !beschreibungLang;

  return (
    <div className="modal-hintergrund" {...hintergrundSchliessen(onSchliessen)}>
      <div className="aw-fenster" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={pendenz.titel}>
        <header className="aw-kopf">
          <div className="aw-kopf-text">
            <div className="aw-pfad">
              {mandant ? <span className="aw-mandant">{mandant.name}</span> : <span className="aw-mandant">Intern</span>}
              {!istProjekt && pendenz.eltern_titel && <span> · {pendenz.eltern_titel}</span>}
              <span className="aw-id">#{pendenz.id}</span>
            </div>
            <h2 className="aw-titel">{pendenz.titel}</h2>
            <div className="aw-chips">
              <select className={`aw-status status-${statusSlug(pendenz.status)}`} value={pendenz.status} onChange={(e) => statusSetzen(pendenz, e.target.value)} aria-label="Status">
                {STATUS_WERTE.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <span className={`aw-chip aw-prio-${pendenz.prioritaet}`}>Prio {pendenz.prioritaet}</span>
              {pendenz.faelligkeit && <span className={`aw-chip ${fristUeber ? 'aw-chip-rot' : ''}`}>Frist {formatiereDatum(pendenz.faelligkeit)}{pendenz.harte_frist ? ' · hart' : ''}</span>}
              {pendenz.bearbeitungstag && <span className="aw-chip">Bearbeiten am {formatiereDatum(pendenz.bearbeitungstag)}</span>}
              <span className={`aw-chip ${pendenz.verrechnung === 'extra' ? 'aw-chip-extra' : ''}`}>{pendenz.verrechnung === 'extra' ? 'Extra (verrechnen)' : 'Pauschal'}</span>
              {pendenz.status === 'Warten auf' && <span className="aw-chip">Wartet auf {pendenz.warten_auf_person}{pendenz.wiedervorlage ? ` · nachfassen ${formatiereDatum(pendenz.wiedervorlage)}` : ''}</span>}
            </div>
          </div>
          <div className="aw-kopf-aktionen">
            <TimerKnopf pendenz={pendenz} timer={timer} gross onFehler={setFehler} onStopp={(t) => setZeitOffen({ eintrag: t })} />
            {pendenz.status !== 'Erledigt'
              ? <button type="button" className="btn" onClick={() => statusSetzen(pendenz, 'Erledigt')}>✓ Erledigt</button>
              : <button type="button" className="btn" onClick={() => statusSetzen(pendenz, 'Offen')}>Wieder öffnen</button>}
            <button type="button" className="btn" onClick={() => onBearbeiten(pendenz)}>Bearbeiten</button>
            <button type="button" className="modal-schliessen" onClick={onSchliessen} aria-label="Schliessen">×</button>
          </div>
        </header>
        {timer && timer.pendenz_id !== pendenz.id && !schritte.some((s) => s.id === timer.pendenz_id) && (
          <div className="aw-hinweis-timer">Timer läuft bei «{timer.pendenzen?.titel ?? timer.beschreibung ?? 'anderer Arbeit'}» seit {uhrzeitAus(timer.timer_start)} – Start hier stoppt ihn.</div>
        )}
        {fehler && <div className="hinweis-fehler aw-fehler">{fehler}</div>}

        <div className="aw-koerper">
          <main className="aw-haupt">
            {istProjekt && (
              <section className="aw-abschnitt">
                <div className="aw-abschnitt-titel">
                  Schritte <span className="aw-zaehler">{erledigt}/{schritte.length} erledigt</span>
                  {schritte.length > 0 && <span className="aw-fortschritt"><span style={{ width: `${(erledigt / schritte.length) * 100}%` }} /></span>}
                </div>
                <ul className="aw-schritte">
                  {schritte.map((s) => {
                    const fertigS = s.status === 'Erledigt';
                    const minuten = zeitProSchritt.get(s.id) ?? 0;
                    return (
                      <li key={s.id} className={`aw-schritt ${fertigS ? 'erledigt' : ''} ${s.status === 'In Arbeit' ? 'aktiv' : ''}`}>
                        <button type="button" className={`abhaken ${fertigS ? 'aktiv' : ''}`} aria-label={fertigS ? 'Wieder öffnen' : 'Erledigt'} onClick={() => statusSetzen(s, fertigS ? 'Offen' : 'Erledigt')}>{fertigS ? '✓' : ''}</button>
                        <button type="button" className="aw-schritt-titel" onClick={() => onBearbeiten(s)} title="Schritt bearbeiten">{s.titel}</button>
                        <span className="aw-schritt-meta">
                          {!fertigS && s.status !== 'Offen' && <span className={`zeile-status-tag status-${statusSlug(s.status)}`}>{s.status}</span>}
                          {s.bearbeitungstag && <span>{formatiereDatum(s.bearbeitungstag)}</span>}
                          {s.aufwand_minuten ? <span title="geschätzt">≈ {formatiereAufwand(s.aufwand_minuten)}</span> : null}
                          {minuten > 0 && <span className="aw-schritt-zeit" title="erfasst">{formatiereDauer(minuten)}</span>}
                          {s.verrechnung === 'extra' && <span className="aw-mini-extra">Extra</span>}
                        </span>
                        {!fertigS && <TimerKnopf pendenz={s} timer={timer} onFehler={setFehler} onStopp={(t) => setZeitOffen({ eintrag: t })} />}
                      </li>
                    );
                  })}
                </ul>
                <div className="aw-neu">
                  <input value={neuerSchritt} onChange={(e) => setNeuerSchritt(e.target.value)} placeholder="+ Schritt hinzufügen (Verb + Objekt) und Enter"
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); schrittHinzufuegen(); } }} />
                </div>
              </section>
            )}

            <section className="aw-abschnitt">
              <div className="aw-abschnitt-titel">Beschreibung</div>
              {beschreibung
                ? <div className="aw-beschreibung">{beschreibungKurz ? `${beschreibung.slice(0, 420)}…` : beschreibung}{beschreibung.length > 420 && <button type="button" className="link-knopf" onClick={() => setBeschreibungLang((x) => !x)}>{beschreibungLang ? ' weniger' : ' mehr anzeigen'}</button>}</div>
                : <div className="aw-leer">Keine Beschreibung – unter «Bearbeiten» ergänzen.</div>}
            </section>

            <section className="aw-abschnitt">
              <div className="aw-abschnitt-titel">Verlauf</div>
              <div className="aw-notiz-neu">
                <textarea ref={notizRef} rows={2} value={neueNotiz} onChange={(e) => setNeueNotiz(e.target.value)} placeholder="Was ist passiert? z.B. «Unterlagen beim Kunden angefordert»"
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) notizHinzufuegen(); }} />
                <div className="aw-notiz-knoepfe">
                  <DiktatKnopf titel="Eintrag diktieren" onText={(t) => setNeueNotiz((x) => textAnhaengen(x, t))} />
                  <button type="button" className="btn-klein btn-klein-primaer" onClick={notizHinzufuegen} disabled={!neueNotiz.trim()}>Eintragen</button>
                </div>
              </div>
              <ul className="aw-verlauf">
                {notizen.map((n) => (
                  <li key={n.id}>
                    <div className="aw-verlauf-kopf">{formatiereZeitstempel(n.erstellt_am)}{n.mitarbeiter_name ? ` · ${n.mitarbeiter_name}` : ''}
                      <button type="button" className="notiz-loeschen" aria-label="Eintrag löschen" onClick={() => tun(() => api.pendenzen.notizLoeschen(pendenz.id, n.id))}>×</button>
                    </div>
                    <div className="aw-verlauf-text">{n.text}</div>
                  </li>
                ))}
                {notizen.length === 0 && <li className="aw-leer">Noch keine Einträge.</li>}
              </ul>
            </section>
          </main>

          <aside className="aw-seite">
            <section className="aw-karte">
              <div className="aw-abschnitt-titel">Zeit</div>
              <div className="aw-zeit-gross">{stunden(summe.gesamt)}<span className="aw-zeit-von">{geschaetzt ? ` von ≈ ${stunden(geschaetzt)}` : ''}</span></div>
              {anteil != null && (
                <div className="aw-zeitbalken" title={`${Math.round(anteil * 100)} % der Schätzung`}>
                  <span className={anteil > 1.1 ? 'rot' : anteil > 0.9 ? 'gelb' : 'gruen'} style={{ width: `${Math.min(anteil, 1) * 100}%` }} />
                </div>
              )}
              <div className="aw-zeit-split">
                <span><i className="aw-punkt pauschal" />Pauschal {stunden(summe.pauschal)}</span>
                <span><i className="aw-punkt extra" />Extra {stunden(summe.extra)}</span>
              </div>
              {offeneZeit.length > 0 && mandant && (
                <div className="aw-extra-offen">
                  Noch nicht rapportiert: <strong>{stunden(offeneZeit.reduce((s2, z) => s2 + z.minuten, 0))}</strong>{extraOffen > 0 ? <> · davon Extra <strong>{chf(extraOffen)}</strong></> : null}
                  <button type="button" className="btn-klein btn-klein-primaer aw-rapportieren" onClick={rapportieren}>Rapportieren →</button>
                </div>
              )}
              <ul className="aw-zeitliste">
                {fertig.slice(0, 6).map((z) => (
                  <li key={z.id}>
                    <button type="button" onClick={() => setZeitOffen({ eintrag: z })} title="Eintrag korrigieren">
                      <span>{formatiereDatum(z.datum)}</span>
                      <span className="aw-zeitliste-text">{z.pendenz_id !== pendenz.id ? (z.pendenzen?.titel ?? '') : (z.mitarbeitende?.name ?? '')}</span>
                      <span className={`zeit-art zeit-art-${z.art}`}>{artLabel(z.art)}</span>
                      <span className="aw-zeitliste-dauer">{formatiereDauer(z.minuten)}</span>
                    </button>
                  </li>
                ))}
                {fertig.length === 0 && <li className="aw-leer">Noch keine Zeit erfasst.</li>}
              </ul>
              <div className="aw-zeit-knoepfe">
                <button type="button" className="btn-klein" onClick={() => setZeitOffen({ neu: pendenz })}>+ Zeit nachtragen</button>
                <Link className="btn-klein" to="/zeit" onClick={onSchliessen}>Zeitjournal</Link>
              </div>
            </section>

            <section className="aw-karte">
              <div className="aw-abschnitt-titel">Details</div>
              <dl className="aw-details">
                <dt>Mandant</dt><dd>{mandant?.name ?? 'Intern'}{mandant && <AblageKnoepfe mandant={mandant} />}</dd>
                <dt>Bearbeiter/in</dt><dd>{bearbeiter?.name ?? '–'}</dd>
                {pendenz.leistung_id && <><dt>Leistung</dt><dd>{leistungen.find((l) => l.id === pendenz.leistung_id)?.name ?? '–'}</dd></>}
                <dt>Block</dt><dd>{pendenz.block || '–'}</dd>
                {!istProjekt && pendenz.aufwand_minuten ? <><dt>Aufwand</dt><dd>≈ {formatiereAufwand(pendenz.aufwand_minuten)}</dd></> : null}
                <dt>Erstellt</dt><dd>{formatiereZeitstempel(pendenz.erstellt_am)}</dd>
              </dl>
              <div className="aw-zeit-knoepfe">
                <button type="button" className="btn-klein" onClick={() => ladeICSHerunter(pendenz)}>📅 Kalender</button>
                <button type="button" className="btn-klein btn-gefahr-text" onClick={loeschen}>Löschen</button>
              </div>
            </section>

            <section className="aw-karte">
              <DateienListe pendenzIds={[pendenz.id, ...schritte.map((s) => s.id)]} mandant={mandant} hochladenFuer={{ pendenzId: pendenz.id, mandantId: pendenz.mandant_id }} leerAusblenden={false} />
            </section>
          </aside>
        </div>
      </div>

      {zeitOffen && createPortal(
        <ZeitModal
          eintrag={zeitOffen.eintrag ?? null}
          pendenz={zeitOffen.neu ?? null}
          onSchliessen={() => setZeitOffen(null)}
          onGespeichert={() => { setZeitOffen(null); laden(); }}
        />,
        document.body,
      )}
    </div>
  );
}
