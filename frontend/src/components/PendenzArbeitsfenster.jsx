import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api.js';
import ZeitModal from './ZeitModal.jsx';
import DateienListe from './DateienListe.jsx';
import AblageKnoepfe from './AblageKnoepfe.jsx';
import DiktatKnopf from './DiktatKnopf.jsx';
import { textAnhaengen } from '../lib/diktat.js';
import { useLaufenderTimer, timerStarten } from '../lib/timer.js';
import { aufAenderungHoeren, aufZeitAenderungHoeren, meldeAenderung, meldeZeitAenderung } from '../events.js';
import { STATUS_WERTE, formatiereAufwand, statusSlug } from '../constants.js';
import { formatiereDatum, formatiereZeitstempel, heutigesDatumISO } from '../format.js';
import { formatiereDauer, laufendeMinuten, uhrzeitAus, uhrzeitPlus, zusammenfassung, artLabel, betragExtra, parseDauer } from '../lib/zeit.js';
import { ladeICSHerunter } from '../lib/ics.js';
import { hintergrundSchliessen } from '../lib/modal.js';
import { chf } from '../lib/offerte.js';
import { useLeistungen } from '../hooks.js';

const GROESSE_SCHLUESSEL = 'arbeitsfenster-groesse';
const stunden = (min) => (min >= 60 ? `${(min / 60).toLocaleString('de-CH', { maximumFractionDigits: 1 })} h` : `${Math.round(min || 0)} Min.`);

function TimerKnopf({ pendenz, timer, gross = false, beschriftung = 'Start', onFehler, onStopp }) {
  const laeuftHier = timer && timer.pendenz_id === pendenz.id;
  if (laeuftHier) {
    return (
      <button type="button" className={`aw-timer aw-timer-laeuft ${gross ? 'aw-timer-gross' : ''}`} onClick={(e) => { e.stopPropagation(); onStopp(timer); }} title="Stoppen – die Zeit erscheint im Verlauf">
        <span className="aw-timer-punkt" />■ {formatiereDauer(laufendeMinuten(timer.timer_start))}{gross ? ' · Stopp' : ''}
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`aw-timer ${gross ? 'aw-timer-gross' : ''}`}
      title={timer ? 'Startet hier – der laufende Timer wird gestoppt und gespeichert.' : `Zeit messen für «${pendenz.titel}»`}
      onClick={async (e) => { e.stopPropagation(); try { await timerStarten(pendenz); } catch (err) { onFehler(err.message); } }}
    >
      ▶{gross ? ` ${beschriftung}` : ''}
    </button>
  );
}

// Arbeitsfenster: immer das ganze Projekt (auch wenn ein Schritt angewaehlt wurde) -- oben das
// Projekt, darunter der aktuelle Schritt mit Timer, links Schritte und Verlauf (Zeitachse aus
// Zeiteintraegen und Notizen), rechts Zeit und Details. Groesse per Regler, pro Geraet gemerkt.
export default function PendenzArbeitsfenster({ pendenz: start, mandanten = [], mitarbeitende = [], onSchliessen, onBearbeiten, onGeloescht }) {
  const projektId = start.uebergeordnete_pendenz_id ?? start.id;
  const [projekt, setProjekt] = useState(start.uebergeordnete_pendenz_id ? null : start);
  const [schritte, setSchritte] = useState([]);
  const [fokusId, setFokusId] = useState(start.uebergeordnete_pendenz_id ? start.id : null);
  const [zeiten, setZeiten] = useState([]);
  const [notizen, setNotizen] = useState([]);
  const [eingabe, setEingabe] = useState({ text: '', dauer: '', art: '', schrittId: '' });
  const [neuerSchritt, setNeuerSchritt] = useState('');
  const [zeitOffen, setZeitOffen] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [beschreibungLang, setBeschreibungLang] = useState(false);
  const [groesse, setGroesse] = useState(() => { try { return Number(localStorage.getItem(GROESSE_SCHLUESSEL)) || 80; } catch { return 80; } });
  const timer = useLaufenderTimer();
  const leistungen = useLeistungen();
  const navigate = useNavigate();
  const heute = heutigesDatumISO();

  function groesseAendern(wert) {
    setGroesse(wert);
    try { localStorage.setItem(GROESSE_SCHLUESSEL, String(wert)); } catch { /* ohne Speicher weiter */ }
  }

  const laden = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([api.pendenzen.holen(projektId), api.pendenzen.teilaufgaben(projektId)]);
      const ids = [projektId, ...s.map((x) => x.id)];
      const [z, n] = await Promise.all([
        api.zeit.liste({ pendenzIds: ids }),
        Promise.all(ids.map((id) => api.pendenzen.notizen(id).then((l) => l.map((x) => ({ ...x, pendenz_id: id }))).catch(() => []))),
      ]);
      setProjekt(p); setSchritte(s); setZeiten(z); setNotizen(n.flat());
    } catch (e) { setFehler(e.message); }
  }, [projektId]);
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

  if (!projekt) {
    return (
      <div className="modal-hintergrund" {...hintergrundSchliessen(onSchliessen)}>
        <div className="aw-fenster aw-laedt" onClick={(e) => e.stopPropagation()}>{fehler ? <div className="hinweis-fehler">{fehler}</div> : 'Lädt…'}</div>
      </div>
    );
  }

  const offeneSchritte = schritte.filter((s) => s.status !== 'Erledigt');
  // Aktueller Schritt: angewaehlt, sonst der laufende, sonst der erste offene.
  const fokus = schritte.find((s) => s.id === fokusId)
    ?? schritte.find((s) => timer?.pendenz_id === s.id)
    ?? offeneSchritte.find((s) => s.status === 'In Arbeit') ?? offeneSchritte[0] ?? null;
  const arbeitAn = fokus ?? projekt; // Ziel fuer Timer und Verlauf
  const mandant = mandanten.find((m) => m.id === projekt.mandant_id) ?? null;
  const bearbeiter = mitarbeitende.find((m) => m.id === projekt.bearbeiter_id) ?? null;
  const titelVon = (id) => (id === projekt.id ? null : schritte.find((s) => s.id === id)?.titel ?? null);

  async function tun(fn) {
    setFehler(null);
    try { await fn(); meldeAenderung(); await laden(); } catch (e) { setFehler(e.message); }
  }
  const statusSetzen = (p, status) => tun(() => api.pendenzen.statusAendern(p.id, status));
  const schrittHinzufuegen = () => tun(async () => {
    const titel = neuerSchritt.trim();
    if (!titel) return;
    await api.pendenzen.erstellen({
      titel, mandantId: projekt.mandant_id, bearbeiterId: projekt.bearbeiter_id, prioritaet: projekt.prioritaet,
      faelligkeit: projekt.faelligkeit, block: projekt.block, verrechnung: projekt.verrechnung,
      uebergeordnetePendenzId: projekt.id, reihenfolge: (schritte.at(-1)?.reihenfolge ?? schritte.length) + 1,
      status: offeneSchritte.length ? 'Später' : 'Offen',
    });
    setNeuerSchritt('');
  });
  const loeschen = () => tun(async () => {
    if (!window.confirm(`Projekt «${projekt.titel}» löschen?${schritte.length ? ` Die ${schritte.length} Schritte werden mitgelöscht.` : ''}`)) return;
    await api.pendenzen.loeschen(projekt.id);
    onGeloescht?.();
    onSchliessen();
  });

  // Verlauf: Eintrag mit Dauer = Zeiteintrag (erscheint im Rapport), ohne Dauer = Notiz.
  const eintragSchrittId = Number(eingabe.schrittId) || arbeitAn.id;
  const eintragArt = eingabe.art || (schritte.find((s) => s.id === eintragSchrittId) ?? projekt).verrechnung || 'pauschal';
  const dauerMinuten = eingabe.dauer.trim() ? parseDauer(eingabe.dauer) : null;
  const eintragen = () => tun(async () => {
    const text = eingabe.text.trim();
    if (!text) throw new Error('Bitte beschreiben, was gemacht wurde.');
    if (eingabe.dauer.trim() && !dauerMinuten) throw new Error('Dauer z.B. als 0:45, 1.5 oder 90 eingeben.');
    if (dauerMinuten) {
      await api.zeit.speichern(null, {
        mandantId: projekt.mandant_id, pendenzId: eintragSchrittId, leistungId: projekt.leistung_id,
        art: projekt.mandant_id ? eintragArt : 'intern', datum: heute, minuten: dauerMinuten, beschreibung: text,
      });
      meldeZeitAenderung();
    } else {
      await api.pendenzen.notizErstellen(eintragSchrittId, text);
    }
    setEingabe((x) => ({ ...x, text: '', dauer: '' }));
  });

  const fertig = zeiten.filter((z) => z.minuten != null);
  const verlauf = [
    ...fertig.map((z) => ({ typ: 'zeit', id: `z${z.id}`, wann: z.timer_start ?? `${z.datum}T12:00:00`, z })),
    ...notizen.map((n) => ({ typ: 'notiz', id: `n${n.id}`, wann: n.erstellt_am, n })),
  ].sort((a, b) => (a.wann < b.wann ? 1 : -1));

  const summe = zusammenfassung(fertig);
  const geschaetzt = schritte.length ? schritte.reduce((s, x) => s + (x.aufwand_minuten || 0), 0) : projekt.aufwand_minuten || 0;
  const anteil = geschaetzt ? summe.gesamt / geschaetzt : null;
  const offeneZeit = fertig.filter((z) => !z.rapport_id && z.mandant_id && z.art !== 'intern');
  const extraOffen = offeneZeit.filter((z) => z.art === 'extra').reduce((s, z) => s + (betragExtra(z) ?? 0), 0);
  const rapportieren = () => {
    const von = offeneZeit.reduce((min, z) => (z.datum < min ? z.datum : min), heute);
    onSchliessen();
    navigate(`/rapporte/neu?mandant=${projekt.mandant_id}&von=${von}&bis=${heute}`);
  };
  const zeitProSchritt = new Map();
  for (const z of fertig) zeitProSchritt.set(z.pendenz_id, (zeitProSchritt.get(z.pendenz_id) ?? 0) + z.minuten);
  const erledigt = schritte.length - offeneSchritte.length;
  const fristUeber = projekt.faelligkeit && projekt.faelligkeit < heute && projekt.status !== 'Erledigt';
  const beschreibung = projekt.beschreibung ?? '';
  const beschreibungKurz = beschreibung.length > 320 && !beschreibungLang;

  return (
    <div className="modal-hintergrund" {...hintergrundSchliessen(onSchliessen)}>
      <div
        className="aw-fenster"
        style={{ width: `calc(${groesse}vw / var(--app-zoom, 1))`, height: `calc(${Math.min(groesse + 6, 100)}vh / var(--app-zoom, 1))` }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={projekt.titel}
      >
        <header className="aw-kopf">
          <div className="aw-kopf-text">
            <div className="aw-pfad">
              <span className="aw-mandant">{mandant?.name ?? 'Intern'}</span>
              <span className="aw-projekt-label">Projekt #{projekt.id}</span>
            </div>
            <h2 className="aw-titel">{projekt.titel}</h2>
            <div className="aw-chips">
              <select className={`aw-status status-${statusSlug(projekt.status)}`} value={projekt.status} onChange={(e) => statusSetzen(projekt, e.target.value)} aria-label="Status des Projekts">
                {STATUS_WERTE.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <span className={`aw-chip aw-prio-${projekt.prioritaet}`}>Prio {projekt.prioritaet}</span>
              {projekt.faelligkeit && <span className={`aw-chip ${fristUeber ? 'aw-chip-rot' : ''}`}>Frist {formatiereDatum(projekt.faelligkeit)}{projekt.harte_frist ? ' · hart' : ''}</span>}
              <span className={`aw-chip ${projekt.verrechnung === 'extra' ? 'aw-chip-extra' : ''}`}>{projekt.verrechnung === 'extra' ? 'Extra (verrechnen)' : 'Pauschal'}</span>
              {schritte.length > 0 && <span className="aw-chip">{erledigt}/{schritte.length} Schritte erledigt</span>}
            </div>
          </div>
          <div className="aw-kopf-aktionen">
            <label className="mail-groesse aw-groesse" title="Fenstergrösse">
              <span aria-hidden="true">⤡</span>
              <input type="range" min="50" max="100" step="5" value={groesse} onChange={(e) => groesseAendern(Number(e.target.value))} aria-label="Fenstergrösse" />
            </label>
            <button type="button" className="btn" onClick={() => onBearbeiten(projekt)}>Bearbeiten</button>
            <button type="button" className="modal-schliessen" onClick={onSchliessen} aria-label="Schliessen">×</button>
          </div>
        </header>

        <div className={`aw-jetzt ${timer?.pendenz_id === arbeitAn.id ? 'laeuft' : ''}`}>
          <div className="aw-jetzt-text">
            <div className="aw-jetzt-label">{fokus ? 'Aktueller Schritt' : 'Arbeit am Projekt'}</div>
            <div className="aw-jetzt-titel">{arbeitAn.titel}</div>
            {fokus && (
              <div className="aw-jetzt-meta">
                {fokus.status !== 'Offen' && <span className={`zeile-status-tag status-${statusSlug(fokus.status)}`}>{fokus.status}</span>}
                {fokus.bearbeitungstag && <span>Bearbeiten am {formatiereDatum(fokus.bearbeitungstag)}</span>}
                {fokus.aufwand_minuten ? <span>≈ {formatiereAufwand(fokus.aufwand_minuten)}</span> : null}
                {zeitProSchritt.get(fokus.id) ? <span>erfasst {formatiereDauer(zeitProSchritt.get(fokus.id))}</span> : null}
              </div>
            )}
          </div>
          <TimerKnopf pendenz={arbeitAn} timer={timer} gross beschriftung="Start" onFehler={setFehler} onStopp={(t) => setZeitOffen({ eintrag: t })} />
          {fokus
            ? <button type="button" className="btn" onClick={() => statusSetzen(fokus, 'Erledigt')} disabled={fokus.status === 'Erledigt'}>✓ Schritt erledigt</button>
            : projekt.status !== 'Erledigt'
              ? <button type="button" className="btn" onClick={() => statusSetzen(projekt, 'Erledigt')}>✓ Erledigt</button>
              : <button type="button" className="btn" onClick={() => statusSetzen(projekt, 'Offen')}>Wieder öffnen</button>}
        </div>
        {timer && timer.pendenz_id !== projekt.id && !schritte.some((s) => s.id === timer.pendenz_id) && (
          <div className="aw-hinweis-timer">Timer läuft bei «{timer.pendenzen?.titel ?? timer.beschreibung ?? 'anderer Arbeit'}» seit {uhrzeitAus(timer.timer_start)} – Start hier stoppt ihn.</div>
        )}
        {fehler && <div className="hinweis-fehler aw-fehler">{fehler}</div>}

        <div className="aw-koerper">
          <main className="aw-haupt">
            <section className="aw-abschnitt">
              <div className="aw-abschnitt-titel">
                Schritte <span className="aw-zaehler">{erledigt}/{schritte.length} erledigt · Klick wählt den aktuellen Schritt</span>
                {schritte.length > 0 && <span className="aw-fortschritt"><span style={{ width: `${(erledigt / schritte.length) * 100}%` }} /></span>}
              </div>
              <ul className="aw-schritte">
                {schritte.map((s) => {
                  const fertigS = s.status === 'Erledigt';
                  const minuten = zeitProSchritt.get(s.id) ?? 0;
                  return (
                    <li key={s.id} className={`aw-schritt ${fertigS ? 'erledigt' : ''} ${fokus?.id === s.id ? 'fokus' : ''}`} onClick={() => !fertigS && setFokusId(s.id)}>
                      <button type="button" className={`abhaken ${fertigS ? 'aktiv' : ''}`} aria-label={fertigS ? 'Wieder öffnen' : 'Erledigt'} onClick={(e) => { e.stopPropagation(); statusSetzen(s, fertigS ? 'Offen' : 'Erledigt'); }}>{fertigS ? '✓' : ''}</button>
                      <span className="aw-schritt-titel">{s.titel}</span>
                      <span className="aw-schritt-meta">
                        {!fertigS && s.status !== 'Offen' && <span className={`zeile-status-tag status-${statusSlug(s.status)}`}>{s.status}</span>}
                        {s.bearbeitungstag && <span>{formatiereDatum(s.bearbeitungstag)}</span>}
                        {s.aufwand_minuten ? <span title="geschätzt">≈ {formatiereAufwand(s.aufwand_minuten)}</span> : null}
                        {minuten > 0 && <span className="aw-schritt-zeit" title="erfasst">{formatiereDauer(minuten)}</span>}
                        {s.verrechnung === 'extra' && <span className="aw-mini-extra">Extra</span>}
                      </span>
                      <button type="button" className="aw-schritt-bearbeiten" onClick={(e) => { e.stopPropagation(); onBearbeiten(s); }} title="Schritt bearbeiten" aria-label="Schritt bearbeiten">✎</button>
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

            <section className="aw-abschnitt">
              <div className="aw-abschnitt-titel">Verlauf <span className="aw-zaehler">erledigte Arbeit mit Zeit · Timer-Stopp ergänzt automatisch</span></div>
              <div className="aw-eingabe">
                <textarea rows={2} value={eingabe.text} onChange={(e) => setEingabe((x) => ({ ...x, text: e.target.value }))} placeholder="Was wurde gemacht? z.B. «Belege Q3 kontiert, Rückfragen an Kunde»"
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) eintragen(); }} />
                <div className="aw-eingabe-zeile">
                  <label className="aw-eingabe-feld">Dauer
                    <input value={eingabe.dauer} onChange={(e) => setEingabe((x) => ({ ...x, dauer: e.target.value }))} placeholder="0:30" className={eingabe.dauer && !dauerMinuten ? 'ungueltig' : ''} />
                  </label>
                  {projekt.mandant_id && (
                    <span className="ra-umschalter" role="group" aria-label="Verrechnung">
                      {['pauschal', 'extra'].map((a) => (
                        <button key={a} type="button" className={eintragArt === a ? 'aktiv' : ''} onClick={() => setEingabe((x) => ({ ...x, art: a }))}>{a === 'pauschal' ? 'Pauschal' : 'Extra'}</button>
                      ))}
                    </span>
                  )}
                  {schritte.length > 0 && (
                    <select value={eingabe.schrittId || String(arbeitAn.id)} onChange={(e) => setEingabe((x) => ({ ...x, schrittId: e.target.value }))} aria-label="Gehört zu">
                      <option value={String(projekt.id)}>Projekt allgemein</option>
                      {schritte.map((s) => <option key={s.id} value={String(s.id)}>{s.titel}</option>)}
                    </select>
                  )}
                  <DiktatKnopf titel="Diktieren" onText={(t) => setEingabe((x) => ({ ...x, text: textAnhaengen(x.text, t) }))} />
                  <button type="button" className="btn btn-primary" onClick={eintragen} disabled={!eingabe.text.trim()}>{dauerMinuten ? `Eintragen (${formatiereDauer(dauerMinuten)})` : 'Notiz eintragen'}</button>
                </div>
              </div>
              <ul className="aw-verlauf">
                {verlauf.map((v) => (v.typ === 'zeit' ? (
                  <li key={v.id} className={`aw-v-zeit aw-v-${v.z.art}`}>
                    <button type="button" className="aw-v-knopf" onClick={() => setZeitOffen({ eintrag: v.z })} title={v.z.rapport_id ? 'Bereits rapportiert' : 'Eintrag korrigieren'}>
                      <div className="aw-verlauf-kopf">
                        <strong>{formatiereDatum(v.z.datum)}{v.z.timer_start ? ` ${uhrzeitAus(v.z.timer_start)}–${uhrzeitPlus(uhrzeitAus(v.z.timer_start), v.z.minuten)}` : ''}</strong>
                        <span className="aw-v-dauer">{formatiereDauer(v.z.minuten)}</span>
                        <span className={`zeit-art zeit-art-${v.z.art}`}>{artLabel(v.z.art)}</span>
                        {titelVon(v.z.pendenz_id) && <span className="aw-v-schritt">{titelVon(v.z.pendenz_id)}</span>}
                        {v.z.mitarbeitende?.name && <span>{v.z.mitarbeitende.name}</span>}
                        {v.z.rapport_id && <span className="aw-v-rapportiert">rapportiert</span>}
                      </div>
                      <div className="aw-verlauf-text">{v.z.beschreibung || '–'}</div>
                    </button>
                  </li>
                ) : (
                  <li key={v.id} className="aw-v-notiz">
                    <div className="aw-verlauf-kopf">
                      {formatiereZeitstempel(v.n.erstellt_am)}{v.n.mitarbeiter_name ? ` · ${v.n.mitarbeiter_name}` : ''}
                      {titelVon(v.n.pendenz_id) && <span className="aw-v-schritt">{titelVon(v.n.pendenz_id)}</span>}
                      <span className="aw-v-notizlabel">Notiz</span>
                      <button type="button" className="notiz-loeschen" aria-label="Notiz löschen" onClick={() => tun(() => api.pendenzen.notizLoeschen(v.n.pendenz_id, v.n.id))}>×</button>
                    </div>
                    <div className="aw-verlauf-text">{v.n.text}</div>
                  </li>
                )))}
                {verlauf.length === 0 && <li className="aw-leer">Noch nichts erfasst – Timer starten oder oben eintragen.</li>}
              </ul>
            </section>

            <section className="aw-abschnitt">
              <div className="aw-abschnitt-titel">Beschreibung</div>
              {beschreibung
                ? <div className="aw-beschreibung">{beschreibungKurz ? `${beschreibung.slice(0, 320)}…` : beschreibung}{beschreibung.length > 320 && <button type="button" className="link-knopf" onClick={() => setBeschreibungLang((x) => !x)}>{beschreibungLang ? ' weniger' : ' mehr anzeigen'}</button>}</div>
                : <div className="aw-leer">Keine Beschreibung – unter «Bearbeiten» ergänzen.</div>}
            </section>
          </main>

          <aside className="aw-seite">
            <section className="aw-karte">
              <div className="aw-abschnitt-titel">Zeit Projekt</div>
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
              <div className="aw-zeit-knoepfe">
                <button type="button" className="btn-klein" onClick={() => setZeitOffen({ neu: arbeitAn })}>+ Zeit mit Von/Bis</button>
                <Link className="btn-klein" to="/zeit" onClick={onSchliessen}>Zeitjournal</Link>
              </div>
            </section>

            <section className="aw-karte">
              <div className="aw-abschnitt-titel">Details</div>
              <dl className="aw-details">
                <dt>Mandant</dt><dd>{mandant?.name ?? 'Intern'}{mandant && <AblageKnoepfe mandant={mandant} />}</dd>
                <dt>Bearbeiter/in</dt><dd>{bearbeiter?.name ?? '–'}</dd>
                {projekt.leistung_id && <><dt>Leistung</dt><dd>{leistungen.find((l) => l.id === projekt.leistung_id)?.name ?? '–'}</dd></>}
                <dt>Block</dt><dd>{projekt.block || '–'}</dd>
                <dt>Erstellt</dt><dd>{formatiereZeitstempel(projekt.erstellt_am)}</dd>
              </dl>
              <div className="aw-zeit-knoepfe">
                <button type="button" className="btn-klein" onClick={() => ladeICSHerunter(projekt)}>📅 Kalender</button>
                <button type="button" className="btn-klein btn-gefahr-text" onClick={loeschen}>Löschen</button>
              </div>
            </section>

            <section className="aw-karte">
              <DateienListe pendenzIds={[projekt.id, ...schritte.map((s) => s.id)]} mandant={mandant} hochladenFuer={{ pendenzId: projekt.id, mandantId: projekt.mandant_id }} leerAusblenden={false} />
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
