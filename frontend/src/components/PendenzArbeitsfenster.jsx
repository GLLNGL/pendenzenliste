import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api.js';
import ZeitModal from './ZeitModal.jsx';
import DateienListe from './DateienListe.jsx';
import AntwortErhalten from './AntwortErhalten.jsx';
import AblageKnoepfe from './AblageKnoepfe.jsx';
import PendenzenlisteExport from './PendenzenlisteExport.jsx';
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

const GROESSE_SCHLUESSEL = 'arbeitsfenster-groesse-v2';
const GROESSEN = [60, 70, 75, 80, 90, 100];

// Plausibles Datum (Jahr 2000-2099) -- schuetzt vor halb getippten Jahren wie 0002.
const datumGueltig = (iso) => /^20\d{2}-\d{2}-\d{2}$/.test(iso ?? '');

// Datumsfeld, das erst beim Verlassen (oder Enter) speichert -- nicht bei jedem Tastendruck,
// sonst wird beim Tippen des Jahres schon «0002» gespeichert.
function DatumFeld({ wert, onSpeichern, onFehler, label }) {
  const [entwurf, setEntwurf] = useState(wert ?? '');
  useEffect(() => { setEntwurf(wert ?? ''); }, [wert]);
  function uebernehmen() {
    if (entwurf === (wert ?? '')) return;
    if (entwurf && !datumGueltig(entwurf)) { onFehler('Bitte ein gültiges Datum eingeben (TT.MM.JJJJ).'); setEntwurf(wert ?? ''); return; }
    onSpeichern(entwurf);
  }
  return (
    <input type="date" value={entwurf} aria-label={label}
      onChange={(e) => setEntwurf(e.target.value)}
      onBlur={uebernehmen}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') { e.stopPropagation(); setEntwurf(wert ?? ''); } }} />
  );
}
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
  // Nur eine vollstaendige Pendenz sofort zeigen -- sonst erst nach dem Laden.
  const [projekt, setProjekt] = useState(start.uebergeordnete_pendenz_id || !start.status ? null : start);
  const [schritte, setSchritte] = useState([]);
  const [fokusId, setFokusId] = useState(start.uebergeordnete_pendenz_id ? start.id : null);
  const [zeiten, setZeiten] = useState([]);
  const [notizen, setNotizen] = useState([]);
  const [eingabe, setEingabe] = useState(() => ({ text: '', datum: heutigesDatumISO(), dauer: '', art: '', schrittId: '' }));
  const [neuerSchritt, setNeuerSchritt] = useState('');
  const [zeitOffen, setZeitOffen] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [beschreibungLang, setBeschreibungLang] = useState(false);
  // Aus einem Schritt geoeffnet: nur diese Teilaufgabe zeigen (Projekt bleibt im Titel).
  const [nurSchritt, setNurSchritt] = useState(!!start.uebergeordnete_pendenz_id);
  const [erledigtMeldung, setErledigtMeldung] = useState(null);
  // Eingabe fuer "Warten auf" (Person, Nachfassdatum) beim Statuswechsel.
  const [warten, setWarten] = useState(null);
  // Zaehler, damit die Dateiliste nach dem Ablegen einer Antwort neu laedt.
  const [dateienStand, setDateienStand] = useState(0);
  const [groesse, setGroesse] = useState(() => { try { return Number(localStorage.getItem(GROESSE_SCHLUESSEL)) || 75; } catch { return 75; } });
  const timer = useLaufenderTimer();
  const leistungen = useLeistungen();
  const navigate = useNavigate();
  const heute = heutigesDatumISO();

  function groesseAendern(wert) {
    setGroesse(wert);
    try { localStorage.setItem(GROESSE_SCHLUESSEL, String(wert)); } catch { /* ohne Speicher weiter */ }
  }

  // Fenster am Kopf verschieben (ziehen); Doppelklick auf den Kopf zentriert es wieder.
  const [versatz, setVersatz] = useState({ x: 0, y: 0 });
  function ziehenStarten(e) {
    if (e.button !== 0 || e.target.closest('button, input, select, textarea, a, label')) return;
    const fenster = e.currentTarget.closest('.aw-fenster');
    const rect = fenster.getBoundingClientRect();
    const massstab = rect.width / fenster.offsetWidth || 1; // CSS-Zoom der App
    const start = { mx: e.clientX, my: e.clientY, ...versatz };
    const bewegen = (ev) => {
      const dx = Math.min(Math.max(ev.clientX - start.mx, 120 - rect.right), window.innerWidth - 120 - rect.left);
      const dy = Math.min(Math.max(ev.clientY - start.my, -rect.top), window.innerHeight - 60 - rect.top);
      setVersatz({ x: start.x + dx / massstab, y: start.y + dy / massstab });
    };
    const ende = () => {
      window.removeEventListener('pointermove', bewegen);
      window.removeEventListener('pointerup', ende);
      document.body.classList.remove('aw-zieht');
    };
    window.addEventListener('pointermove', bewegen);
    window.addEventListener('pointerup', ende);
    document.body.classList.add('aw-zieht');
    e.preventDefault();
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
  const schrittAnsicht = nurSchritt && !!fokus;
  const titelVon = (id) => (schrittAnsicht || id === projekt.id ? null : schritte.find((s) => s.id === id)?.titel ?? null);
  const fokusIndex = fokus ? schritte.findIndex((s) => s.id === fokus.id) : -1;
  const naechsterOffen = fokus ? schritte.slice(fokusIndex + 1).find((s) => s.status !== 'Erledigt') ?? schritte.find((s) => s.status !== 'Erledigt' && s.id !== fokus.id) ?? null : null;
  const schrittWaehlen = (id) => { setFokusId(id); setErledigtMeldung(null); setEingabe((x) => ({ ...x, schrittId: '' })); };

  async function tun(fn) {
    setFehler(null);
    try { await fn(); meldeAenderung(); await laden(); } catch (e) { setFehler(e.message); }
  }
  const statusSetzen = (p, status) => tun(() => api.pendenzen.statusAendern(p.id, status));
  // "Warten auf" braucht Person und Nachfassdatum -- dafuer eine kleine Eingabe statt Fehler.
  const statusWaehlen = (p, status) => {
    if (status === 'Warten auf') setWarten({ ziel: p, person: p.warten_auf_person ?? '', datum: p.wiedervorlage ?? '' });
    else { setWarten(null); statusSetzen(p, status); }
  };
  const wartenSpeichern = () => tun(async () => {
    if (!warten.person.trim() || !warten.datum) throw new Error('Bitte Person und Nachfassdatum angeben.');
    await api.pendenzen.aktualisieren(warten.ziel.id, { status: 'Warten auf', wartenAufPerson: warten.person, wiedervorlage: warten.datum });
    setWarten(null);
  });
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
  const eintragSchrittId = schrittAnsicht ? fokus.id : Number(eingabe.schrittId) || arbeitAn.id;
  const eintragArt = eingabe.art || (schritte.find((s) => s.id === eintragSchrittId) ?? projekt).verrechnung || 'pauschal';
  const dauerMinuten = eingabe.dauer.trim() ? parseDauer(eingabe.dauer) : null;
  // Datum in der Zukunft = Pendenz auf diesen Tag verschieben (Bearbeiten am), Text als Notiz.
  const zukunft = !!eingabe.datum && eingabe.datum > heute;
  async function eintragSpeichern({ verschieben = true } = {}) {
    const text = eingabe.text.trim();
    if (eingabe.dauer.trim() && !dauerMinuten) throw new Error('Dauer z.B. als 0:45, 1.5 oder 90 eingeben.');
    if (dauerMinuten && !eingabe.datum) throw new Error('Bitte das Datum der Arbeit eingeben.');
    if (dauerMinuten && zukunft) throw new Error('Zeit kann nicht in der Zukunft erfasst werden. Ohne Zeitaufwand wird die Pendenz auf dieses Datum verschoben.');
    if (zukunft && verschieben) {
      if (text) await api.pendenzen.notizErstellen(eintragSchrittId, text);
      await api.pendenzen.aktualisieren(eintragSchrittId, { bearbeitungstag: eingabe.datum });
      setEingabe((x) => ({ ...x, text: '', dauer: '', datum: heute }));
      return true;
    }
    if (!text) return false;
    if (dauerMinuten) {
      await api.zeit.speichern(null, {
        mandantId: projekt.mandant_id, pendenzId: eintragSchrittId, leistungId: projekt.leistung_id,
        art: projekt.mandant_id ? eintragArt : 'intern', datum: eingabe.datum, minuten: dauerMinuten, beschreibung: text,
      });
      meldeZeitAenderung();
    } else {
      await api.pendenzen.notizErstellen(eintragSchrittId, text);
    }
    setEingabe((x) => ({ ...x, text: '', dauer: '' }));
    return true;
  }
  const eintragen = () => tun(async () => {
    if (!eingabe.text.trim() && !zukunft) throw new Error('Bitte beschreiben, was gemacht wurde.');
    await eintragSpeichern();
  });
  const bearbeitungstagSetzen = (p, tag) => tun(() => api.pendenzen.aktualisieren(p.id, { bearbeitungstag: tag || null }));
  // Teilaufgabe erledigen: ein noch nicht eingetragener Statustext wird vorher gespeichert.
  const schrittErledigen = () => tun(async () => {
    if (timer?.pendenz_id === fokus.id) throw new Error('Zuerst den Timer stoppen, damit die Zeit bei dieser Teilaufgabe gespeichert wird.');
    await eintragSpeichern({ verschieben: false });
    await api.pendenzen.statusAendern(fokus.id, 'Erledigt');
    setErledigtMeldung(fokus.titel);
  });

  const fertigAlle = zeiten.filter((z) => z.minuten != null);
  const fertig = schrittAnsicht ? fertigAlle.filter((z) => z.pendenz_id === fokus.id) : fertigAlle;
  const verlauf = [
    ...fertig.map((z) => ({ typ: 'zeit', id: `z${z.id}`, wann: z.timer_start ?? `${z.datum}T12:00:00`, z })),
    ...notizen.filter((n) => !schrittAnsicht || n.pendenz_id === fokus.id).map((n) => ({ typ: 'notiz', id: `n${n.id}`, wann: n.erstellt_am, n })),
  ].sort((a, b) => (a.wann < b.wann ? 1 : -1));

  const summe = zusammenfassung(fertig);
  const summeProjekt = zusammenfassung(fertigAlle);
  const geschaetzt = schrittAnsicht ? fokus.aufwand_minuten || 0
    : schritte.length ? schritte.reduce((s, x) => s + (x.aufwand_minuten || 0), 0) : projekt.aufwand_minuten || 0;
  const anteil = geschaetzt ? summe.gesamt / geschaetzt : null;
  const offeneZeit = fertigAlle.filter((z) => !z.rapport_id && z.mandant_id && z.art !== 'intern');
  const extraOffen = offeneZeit.filter((z) => z.art === 'extra').reduce((s, z) => s + (betragExtra(z) ?? 0), 0);
  const rapportieren = () => {
    const von = offeneZeit.reduce((min, z) => (z.datum < min ? z.datum : min), heute);
    onSchliessen();
    navigate(`/rapporte/neu?mandant=${projekt.mandant_id}&von=${von}&bis=${heute}`);
  };
  const zeitProSchritt = new Map();
  for (const z of fertigAlle) zeitProSchritt.set(z.pendenz_id, (zeitProSchritt.get(z.pendenz_id) ?? 0) + z.minuten);
  const erledigt = schritte.length - offeneSchritte.length;
  const fristUeber = projekt.faelligkeit && projekt.faelligkeit < heute && projekt.status !== 'Erledigt';
  const beschreibung = (schrittAnsicht ? fokus.beschreibung : projekt.beschreibung) ?? '';
  const beschreibungKurz = beschreibung.length > 320 && !beschreibungLang;

  return (
    <div className="modal-hintergrund" {...hintergrundSchliessen(onSchliessen)}>
      <div
        className="aw-fenster"
        style={{
          width: `calc(${groesse}vw / var(--app-zoom, 1))`, height: `calc(${Math.min(groesse + 6, 100)}vh / var(--app-zoom, 1))`,
          transform: versatz.x || versatz.y ? `translate(${versatz.x}px, ${versatz.y}px)` : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={projekt.titel}
      >
        <header className="aw-kopf aw-kopf-ziehbar" onPointerDown={ziehenStarten} onDoubleClick={(e) => { if (!e.target.closest('button, input, select, a, label')) setVersatz({ x: 0, y: 0 }); }}
          title="Am Kopf ziehen, um das Fenster zu verschieben · Doppelklick zentriert">
          <div className="aw-kopf-text">
            <div className="aw-pfad">
              <span className="aw-mandant">{mandant?.name ?? 'Intern'}</span>
              <span className="aw-projekt-label">Projekt #{projekt.id}</span>
            </div>
            <h2 className="aw-titel">{projekt.titel}</h2>
            <div className="aw-chips">
              <select className={`aw-status status-${statusSlug(projekt.status)}`} value={warten?.ziel.id === projekt.id ? 'Warten auf' : projekt.status} onChange={(e) => statusWaehlen(projekt, e.target.value)} aria-label="Status des Projekts"
                title="Status des ganzen Projekts – bleibt so, bis du ihn änderst oder alle Teilaufgaben erledigt sind">
                {STATUS_WERTE.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <span className={`aw-chip aw-prio-${projekt.prioritaet}`}>Prio {projekt.prioritaet}</span>
              {projekt.faelligkeit && <span className={`aw-chip ${fristUeber ? 'aw-chip-rot' : ''}`}>Frist {formatiereDatum(projekt.faelligkeit)}{projekt.harte_frist ? ' · hart' : ''}</span>}
              <span className={`aw-chip ${projekt.verrechnung === 'extra' ? 'aw-chip-extra' : ''}`}>{projekt.verrechnung === 'extra' ? 'Extra (verrechnen)' : 'Pauschal'}</span>
              {schritte.length > 0 && <span className="aw-chip">{erledigt}/{schritte.length} Schritte erledigt</span>}
              {projekt.status === 'Warten auf' && !warten && (
                <span className="aw-chip aw-chip-warten">wartet auf {projekt.warten_auf_person || '–'}{projekt.wiedervorlage ? ` · nachfassen ${formatiereDatum(projekt.wiedervorlage)}` : ''}</span>
              )}
            </div>
            {warten && (
              <form className="aw-warten" onSubmit={(e) => { e.preventDefault(); wartenSpeichern(); }}>
                <span className="aw-warten-titel">«{warten.ziel.titel}» wartet auf</span>
                <input value={warten.person} onChange={(e) => setWarten((w) => ({ ...w, person: e.target.value }))} placeholder="Person, z.B. Kunde" aria-label="Warten auf Person" autoFocus />
                <label>nachfassen am <input type="date" value={warten.datum} onChange={(e) => setWarten((w) => ({ ...w, datum: e.target.value }))} aria-label="Nachfassdatum" /></label>
                <button type="submit" className="btn btn-primary">Speichern</button>
                <button type="button" className="btn" onClick={() => setWarten(null)}>Abbrechen</button>
              </form>
            )}
          </div>
          <div className="aw-kopf-aktionen">
            <div className="aw-groesse-wahl" role="group" aria-label="Fenstergrösse">
              <span className="aw-groesse-label">Grösse</span>
              <button type="button" onClick={() => groesseAendern([...GROESSEN].reverse().find((g) => g < groesse) ?? 50)} disabled={groesse <= 50} title="Fenster kleiner" aria-label="Fenster kleiner">−</button>
              <select value={GROESSEN.includes(groesse) ? groesse : ''} onChange={(e) => groesseAendern(Number(e.target.value))} aria-label="Fenstergrösse in Prozent">
                {!GROESSEN.includes(groesse) && <option value="">{groesse} %</option>}
                {GROESSEN.map((g) => <option key={g} value={g}>{g === 100 ? 'Vollbild' : `${g} %`}</option>)}
              </select>
              <button type="button" onClick={() => groesseAendern(GROESSEN.find((g) => g > groesse) ?? 100)} disabled={groesse >= 100} title="Fenster grösser" aria-label="Fenster grösser">+</button>
            </div>
            {/* In der Teilaufgaben-Ansicht bearbeitet «Bearbeiten» die Teilaufgabe; das Projekt
                bleibt ueber den zweiten Knopf erreichbar. */}
            {schrittAnsicht
              ? (
                <>
                  <button type="button" className="btn" onClick={() => onBearbeiten(fokus, fokus)} title="Diese Teilaufgabe bearbeiten">Bearbeiten</button>
                  <button type="button" className="btn" onClick={() => onBearbeiten(projekt, fokus)} title="Das ganze Projekt bearbeiten">Projekt bearbeiten</button>
                </>
              )
              : <button type="button" className="btn" onClick={() => onBearbeiten(projekt)}>Bearbeiten</button>}
            <button type="button" className="modal-schliessen" onClick={onSchliessen} aria-label="Schliessen">×</button>
          </div>
        </header>

        <div className={`aw-jetzt ${timer?.pendenz_id === arbeitAn.id ? 'laeuft' : ''}`}>
          <div className="aw-jetzt-text">
            <div className="aw-jetzt-label">{schrittAnsicht ? `Teilaufgabe ${fokusIndex + 1} von ${schritte.length}` : fokus ? 'Aktueller Schritt' : 'Arbeit am Projekt'}</div>
            <div className="aw-jetzt-titel">{arbeitAn.titel}</div>
            {fokus && (
              <div className="aw-jetzt-meta">
                {schrittAnsicht
                  ? (
                    <select className={`aw-status aw-status-klein status-${statusSlug(fokus.status)}`} value={warten?.ziel.id === fokus.id ? 'Warten auf' : fokus.status} onChange={(e) => statusWaehlen(fokus, e.target.value)} aria-label="Status der Teilaufgabe">
                      {STATUS_WERTE.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )
                  : fokus.status !== 'Offen' && <span className={`zeile-status-tag status-${statusSlug(fokus.status)}`}>{fokus.status}</span>}
                {schrittAnsicht && fokus.status !== 'Erledigt'
                  ? (
                    <label className="aw-jetzt-tag">Bearbeiten am
                      <DatumFeld key={fokus.id} wert={fokus.bearbeitungstag} label="Bearbeiten am" onFehler={setFehler} onSpeichern={(tag) => bearbeitungstagSetzen(fokus, tag)} />
                    </label>
                  )
                  : fokus.bearbeitungstag && <span>Bearbeiten am {formatiereDatum(fokus.bearbeitungstag)}</span>}
                {fokus.aufwand_minuten ? <span>≈ {formatiereAufwand(fokus.aufwand_minuten)}</span> : null}
                {zeitProSchritt.get(fokus.id) ? <span>erfasst {formatiereDauer(zeitProSchritt.get(fokus.id))}</span> : null}
              </div>
            )}
          </div>
          <TimerKnopf pendenz={arbeitAn} timer={timer} gross beschriftung="Start" onFehler={setFehler} onStopp={(t) => setZeitOffen({ eintrag: t })} />
          {fokus
            ? fokus.status === 'Erledigt'
              ? <button type="button" className="btn" onClick={() => { setErledigtMeldung(null); statusSetzen(fokus, 'Offen'); }}>Wieder öffnen</button>
              : <button type="button" className="btn btn-primary" onClick={schrittErledigen} title={eingabe.text.trim() ? 'Der Text im Verlauf wird zuerst eingetragen' : undefined}>✓ {schrittAnsicht ? 'Teilaufgabe' : 'Schritt'} erledigt</button>
            : projekt.status !== 'Erledigt'
              ? <button type="button" className="btn" onClick={() => statusSetzen(projekt, 'Erledigt')}>✓ Erledigt</button>
              : <button type="button" className="btn" onClick={() => statusSetzen(projekt, 'Offen')}>Wieder öffnen</button>}
        </div>
        {timer && timer.pendenz_id !== projekt.id && !schritte.some((s) => s.id === timer.pendenz_id) && (
          <div className="aw-hinweis-timer">Timer läuft bei «{timer.pendenzen?.titel ?? timer.beschreibung ?? 'anderer Arbeit'}» seit {uhrzeitAus(timer.timer_start)} – Start hier stoppt ihn.</div>
        )}
        {erledigtMeldung && fokus?.status === 'Erledigt' && (
          <div className="aw-erledigt-meldung">
            <span>✓ «{erledigtMeldung}» ist erledigt – mit {formatiereDauer(zeitProSchritt.get(fokus.id) ?? 0)} erfasster Zeit. Sie erscheint so im Rapport.</span>
            {naechsterOffen && <button type="button" className="btn-klein btn-klein-primaer" onClick={() => schrittWaehlen(naechsterOffen.id)}>Nächste Teilaufgabe: {naechsterOffen.titel} →</button>}
          </div>
        )}
        {fehler && <div className="hinweis-fehler aw-fehler">{fehler}</div>}

        <div className="aw-koerper">
          <main className="aw-haupt">
            {schrittAnsicht ? (
              <div className="aw-schritt-nav">
                <button type="button" className="btn-klein" disabled={fokusIndex <= 0} onClick={() => schrittWaehlen(schritte[fokusIndex - 1].id)}>← vorherige</button>
                <span>Teilaufgabe {fokusIndex + 1} von {schritte.length} · {erledigt} erledigt</span>
                <button type="button" className="btn-klein" disabled={fokusIndex >= schritte.length - 1} onClick={() => schrittWaehlen(schritte[fokusIndex + 1].id)}>nächste →</button>
              </div>
            ) : (
            <section className="aw-abschnitt">
              <div className="aw-abschnitt-titel">
                Schritte <span className="aw-zaehler">{erledigt}/{schritte.length} erledigt · Klick öffnet die Teilaufgabe</span>
                {schritte.length > 0 && <span className="aw-fortschritt"><span style={{ width: `${(erledigt / schritte.length) * 100}%` }} /></span>}
              </div>
              <ul className="aw-schritte">
                {schritte.map((s) => {
                  const fertigS = s.status === 'Erledigt';
                  const minuten = zeitProSchritt.get(s.id) ?? 0;
                  return (
                    <li key={s.id} className={`aw-schritt ${fertigS ? 'erledigt' : ''} ${fokus?.id === s.id ? 'fokus' : ''}`} onClick={() => { schrittWaehlen(s.id); setNurSchritt(true); }} title="Diese Teilaufgabe bearbeiten">
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
            )}

            {/* Wartet die Teilaufgabe bzw. das Projekt auf jemanden (z.B. Offerte nachfassen):
                Antwort ablegen und neu terminieren. */}
            {(schrittAnsicht ? fokus : projekt)?.status === 'Warten auf' && (
              <AntwortErhalten
                key={(schrittAnsicht ? fokus : projekt).id}
                pendenz={schrittAnsicht ? fokus : projekt}
                mandant={mandant}
                onGeaendert={() => { setDateienStand((n) => n + 1); meldeAenderung(); laden(); }}
              />
            )}

            <section className="aw-abschnitt">
              <div className="aw-abschnitt-titel">{schrittAnsicht ? 'Status & Zeit' : 'Verlauf'} <span className="aw-zaehler">mit Dauer → Rapport · ohne Dauer → Notiz · Timer ergänzt automatisch</span></div>
              <div className="aw-eingabe">
                <textarea rows={schrittAnsicht ? 3 : 2} value={eingabe.text} onChange={(e) => setEingabe((x) => ({ ...x, text: e.target.value }))} placeholder={schrittAnsicht ? 'Stand / was wurde gemacht? z.B. «Unterlagen geprüft, Rückfrage an Kunde gestellt»' : 'Was wurde gemacht? z.B. «Belege Q3 kontiert, Rückfragen an Kunde»'}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) eintragen(); }} />
                <div className="aw-eingabe-zeile">
                  <label className="aw-eingabe-feld">Datum
                    <input type="date" className="aw-eingabe-datum" value={eingabe.datum} title="Vergangen/heute: Datum der Arbeit · Zukunft: Pendenz auf diesen Tag verschieben" onChange={(e) => setEingabe((x) => ({ ...x, datum: e.target.value }))} />
                  </label>
                  <label className="aw-eingabe-feld">Zeitaufwand
                    <input value={eingabe.dauer} onChange={(e) => setEingabe((x) => ({ ...x, dauer: e.target.value }))} placeholder="0:30" className={eingabe.dauer && !dauerMinuten ? 'ungueltig' : ''} />
                  </label>
                  {projekt.mandant_id && (
                    <span className="ra-umschalter" role="group" aria-label="Verrechnung">
                      {['pauschal', 'extra'].map((a) => (
                        <button key={a} type="button" className={eintragArt === a ? 'aktiv' : ''} onClick={() => setEingabe((x) => ({ ...x, art: a }))}>{a === 'pauschal' ? 'Pauschal' : 'Extra'}</button>
                      ))}
                    </span>
                  )}
                  {schritte.length > 0 && !schrittAnsicht && (
                    <select value={eingabe.schrittId || String(arbeitAn.id)} onChange={(e) => setEingabe((x) => ({ ...x, schrittId: e.target.value }))} aria-label="Gehört zu">
                      <option value={String(projekt.id)}>Projekt allgemein</option>
                      {schritte.map((s) => <option key={s.id} value={String(s.id)}>{s.titel}</option>)}
                    </select>
                  )}
                  <DiktatKnopf titel="Diktieren" onText={(t) => setEingabe((x) => ({ ...x, text: textAnhaengen(x.text, t) }))} />
                  <button type="button" className="btn btn-primary" onClick={eintragen} disabled={!eingabe.text.trim() && !zukunft}>
                    {zukunft ? `Auf ${formatiereDatum(eingabe.datum)} verschieben${eingabe.text.trim() ? ' + Notiz' : ''}` : dauerMinuten ? `Eintragen (${formatiereDauer(dauerMinuten)})` : 'Notiz eintragen'}
                  </button>
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
              <div className="aw-abschnitt-titel">{schrittAnsicht ? 'Beschreibung der Teilaufgabe' : 'Beschreibung'}{schrittAnsicht && <button type="button" className="link-knopf aw-titel-link" onClick={() => onBearbeiten(fokus, fokus)}>✎ bearbeiten</button>}</div>
              {beschreibung
                ? <div className="aw-beschreibung">{beschreibungKurz ? `${beschreibung.slice(0, 320)}…` : beschreibung}{beschreibung.length > 320 && <button type="button" className="link-knopf" onClick={() => setBeschreibungLang((x) => !x)}>{beschreibungLang ? ' weniger' : ' mehr anzeigen'}</button>}</div>
                : <div className="aw-leer">Keine Beschreibung – unter «Bearbeiten» ergänzen.</div>}
            </section>
          </main>

          <aside className="aw-seite">
            {/* Belege zuoberst: in der Teilaufgabe haengen sie an der Teilaufgabe, sonst am Projekt
                (dort sind auch die Belege aller Teilaufgaben sichtbar). PDF hineinziehen genuegt. */}
            <section className="aw-karte">
              <DateienListe
                key={`${dateienStand}-${schrittAnsicht ? fokus.id : projekt.id}`}
                titel={schrittAnsicht ? 'Belege der Teilaufgabe' : 'Belege & Dateien'}
                pendenzIds={schrittAnsicht ? [fokus.id] : [projekt.id, ...schritte.map((s) => s.id)]}
                mandant={mandant}
                hochladenFuer={{ pendenzId: schrittAnsicht ? fokus.id : projekt.id, mandantId: projekt.mandant_id }}
                leerAusblenden={false}
              />
            </section>
            <section className="aw-karte">
              <div className="aw-abschnitt-titel">{schrittAnsicht ? 'Zeit Teilaufgabe' : 'Zeit Projekt'}</div>
              <div className="aw-zeit-gross">{stunden(summe.gesamt)}<span className="aw-zeit-von">{geschaetzt ? ` von ≈ ${stunden(geschaetzt)}` : ''}</span></div>
              {schrittAnsicht && <div className="aw-zeit-projekt">Ganzes Projekt: {stunden(summeProjekt.gesamt)}</div>}
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
                {mandant && <PendenzenlisteExport mandant={mandant} klein />}
                <button type="button" className="btn-klein btn-gefahr-text" onClick={loeschen}>Löschen</button>
              </div>
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
