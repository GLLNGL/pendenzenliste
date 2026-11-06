import { useLeistungen } from '../hooks.js';
import PendenzZeit from './PendenzZeit.jsx';
import AblageKnoepfe from './AblageKnoepfe.jsx';
import ProjektModal from './ProjektModal.jsx';
import DiktatKnopf from './DiktatKnopf.jsx';
import { textAnhaengen } from '../lib/diktat.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { STATUS_WERTE, PRIORITAETEN, PRIORITAET_BESCHREIBUNG, AUFWAND_MINUTEN, BLOECKE, formatiereAufwand, statusSlug } from '../constants.js';
import { formatiereDatum, formatiereZeitstempel, heutigesDatumISO } from '../format.js';
import api from '../api.js';
import { meldeAenderung } from '../events.js';
import { ladeICSHerunter } from '../lib/ics.js';
import { blockVorschlag, prioritaetVorschlag } from '../lib/vorschlaege.js';
import { inArbeitErlaubt } from '../lib/wip.js';
import { useAuth } from '../AuthContext.jsx';

// Mandant-Auswahl: '' = noch nicht gewaehlt (Pflicht), 'intern' = bewusst kein Mandant
// (eigenes Buero), sonst die Mandanten-ID.
const INTERN = 'intern';

function leeresFormular(vorgabe) {
  return {
    titel: '',
    mandantId: '',
    bearbeiterId: '',
    beschreibung: '',
    faelligkeit: '',
    harteFrist: false,
    prioritaet: 'B',
    status: 'Offen',
    aufwandMinuten: '',
    leistungId: '',
    block: 'Sonstiges',
    wartenAufPerson: '',
    warteSeit: '',
    wiedervorlage: '',
    bearbeitungstag: '',
    ...vorgabe,
  };
}

function ausPendenz(pendenz) {
  return {
    titel: pendenz.titel,
    // Eine Notiz aus dem Eingang hat noch keinen Mandanten -- dort muss er beim Einplanen erst
    // gewaehlt werden. Eine bereits eingeplante Pendenz ohne Mandant war bewusst "intern".
    mandantId: pendenz.mandant_id ?? (pendenz.geplant === false ? '' : INTERN),
    bearbeiterId: pendenz.bearbeiter_id ?? '',
    beschreibung: pendenz.beschreibung ?? '',
    faelligkeit: pendenz.faelligkeit,
    harteFrist: !!pendenz.harte_frist,
    prioritaet: pendenz.prioritaet,
    // Kann von einer Liste vorausgewaehlt sein (z.B. "Warten auf" im Status-Dropdown gewaehlt,
    // Person/Nachfassdatum fehlen noch -- siehe statusWechselBrauchtFormular).
    status: pendenz.status,
    aufwandMinuten: pendenz.aufwand_minuten ?? '',
    leistungId: pendenz.leistung_id == null ? '' : String(pendenz.leistung_id),
    block: pendenz.block || 'Sonstiges',
    wartenAufPerson: pendenz.warten_auf_person ?? '',
    warteSeit: pendenz.warte_seit ?? '',
    wiedervorlage: pendenz.wiedervorlage ?? '',
    bearbeitungstag: pendenz.bearbeitungstag ?? '',
  };
}

function mandantFuerSpeichern(wert) {
  return wert === '' || wert === INTERN ? null : Number(wert);
}

// Ein Modal fuer Schnellerfassung (pendenz=null) und vollstaendiges Bearbeiten (pendenz gesetzt).
// projektModus: aus der Eingang-Triage "Mehrere Schritte" geoeffnet -- zeigt den Hinweis zur
// Projekt-Logik bei den Schritten.
// Weiche (v7): Neue Pendenzen und Projekte (oberste Ebene) oeffnen das Projekt-Fenster mit
// Teilschritt-Zeilen; Teilschritte und Eingang-Notizen (Triage) das ausfuehrliche Fenster.
export default function PendenzModal(props) {
  const { pendenz, vorgabe, projektModus } = props;
  const alsProjekt = pendenz
    ? pendenz.uebergeordnete_pendenz_id == null && pendenz.geplant !== false
    : !projektModus && !vorgabe?.uebergeordnetePendenzId;
  return alsProjekt ? <ProjektModal {...props} /> : <PendenzDetailModal {...props} />;
}

export function PendenzDetailModal({ pendenz, mandanten, mitarbeitende = [], vorgabe, projektModus = false, onSchliessen, onGespeichert, onGeloescht }) {
  const leistungen = useLeistungen();
  const { benutzer } = useAuth();
  const [formular, setFormular] = useState(() => (pendenz ? ausPendenz(pendenz) : leeresFormular(vorgabe)));
  const [speichertGerade, setSpeichertGerade] = useState(false);
  const [fehler, setFehler] = useState(null);
  // Block wird aus dem naechsten Schritt vorgeschlagen, solange niemand ihn bewusst gewaehlt hat
  // (bei bestehenden Pendenzen gilt ein anderer Block als "Sonstiges" als bewusst gewaehlt).
  const [blockManuell, setBlockManuell] = useState(() => !!pendenz && pendenz.block && pendenz.block !== 'Sonstiges');
  const [blockVorgeschlagen, setBlockVorgeschlagen] = useState(false);
  const titelRef = useRef(null);

  const istHauptaufgabe = !!pendenz && !pendenz.uebergeordnete_pendenz_id;

  // Fuer die Empfaenger-Schnellauswahl beim E-Mail-Versand: die *aktuell im Formular gewaehlten*
  // Mandant/Bearbeiter nachschlagen (nicht die beim Oeffnen geladenen pendenz.mandant_email
  // etc.) -- sonst zeigt der Button nach einem Wechsel im Formular weiter die alte Adresse, bis
  // gespeichert wurde.
  const ausgewaehlterMandant = mandanten.find((m) => m.id === Number(formular.mandantId)) || null;
  const ausgewaehlterBearbeiter = mitarbeitende.find((m) => m.id === Number(formular.bearbeiterId)) || null;
  const [teilaufgaben, setTeilaufgaben] = useState([]);
  const [neueTeilaufgabe, setNeueTeilaufgabe] = useState({ titel: '', faelligkeit: formular.faelligkeit });
  const istProjekt = teilaufgaben.length > 0;

  const prioVorschlag = prioritaetVorschlag(formular, heutigesDatumISO());

  const ladeTeilaufgaben = useCallback(() => {
    if (!istHauptaufgabe) return;
    api.pendenzen.teilaufgaben(pendenz.id).then(setTeilaufgaben).catch(() => {});
  }, [istHauptaufgabe, pendenz]);

  useEffect(() => {
    titelRef.current?.focus();
    ladeTeilaufgaben();
  }, [ladeTeilaufgaben]);

  async function teilaufgabeStatusAendern(teilaufgabe, neuerStatus) {
    try {
      await api.pendenzen.statusAendern(teilaufgabe.id, neuerStatus);
      meldeAenderung();
      ladeTeilaufgaben();
    } catch (err) {
      setFehler(err.message);
    }
  }

  async function teilaufgabeLoeschen(teilaufgabe) {
    if (!window.confirm(`Schritt "${teilaufgabe.titel}" wirklich löschen?`)) return;
    await api.pendenzen.loeschen(teilaufgabe.id);
    meldeAenderung();
    ladeTeilaufgaben();
  }

  async function teilaufgabeVerschieben(index, richtung) {
    const ziel = index + richtung;
    if (ziel < 0 || ziel >= teilaufgaben.length) return;
    try {
      await api.pendenzen.reihenfolgeTauschen(teilaufgaben[index], teilaufgaben[ziel]);
      meldeAenderung();
      ladeTeilaufgaben();
    } catch (err) {
      setFehler(err.message);
    }
  }

  async function teilaufgabeHinzufuegen() {
    if (!neueTeilaufgabe.titel.trim()) return;
    try {
      await api.pendenzen.erstellen({
        titel: neueTeilaufgabe.titel.trim(),
        faelligkeit: neueTeilaufgabe.faelligkeit || null,
        mandantId: mandantFuerSpeichern(formular.mandantId),
        bearbeiterId: formular.bearbeiterId === '' ? null : Number(formular.bearbeiterId),
        prioritaet: formular.prioritaet,
        block: formular.block,
        // Nur der erste offene Schritt bleibt "Offen" -- den Rest stellt der Datenbank-Trigger
        // automatisch auf "Später" (Projekt-Logik).
        status: 'Offen',
        uebergeordnetePendenzId: pendenz.id,
        // Solange das Projekt noch im Eingang liegt, bleiben auch seine Schritte dort.
        geplant: pendenz.geplant !== false,
      });
      meldeAenderung();
      setNeueTeilaufgabe({ titel: '', faelligkeit: formular.faelligkeit });
      ladeTeilaufgaben();
    } catch (err) {
      setFehler(err.message);
    }
  }

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onSchliessen();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSchliessen]);

  const [mailKonfiguriert, setMailKonfiguriert] = useState(null);
  const [emailOffen, setEmailOffen] = useState(false);
  const [emailFormular, setEmailFormular] = useState(() => ({
    // Bewusst nie automatisch vorausgefuellt, auch wenn ein Mandant (mit hinterlegter E-Mail)
    // zugeordnet ist: eine Pendenz-Mail geht nur an eine Adresse, die unten explizit per Klick
    // (Ansprechpartner/in, Geschaeftsfuehrung, Bearbeiter/in) oder manuell ausgewaehlt wurde.
    an: '',
    // Mandant immer zuerst im Betreff, damit man E-Mails im Postfach auf einen Blick zuordnen
    // kann -- ohne Mandant (interne Pendenz) bleibt nur der Titel.
    betreff: pendenz ? (pendenz.mandant_name ? `${pendenz.mandant_name}: ${pendenz.titel}` : pendenz.titel) : '',
    text: pendenz
      ? `Guten Tag\n\nBetrifft "${pendenz.titel}" (fällig am ${formatiereDatum(pendenz.faelligkeit)}).\n\nFreundliche Grüsse`
      : '',
  }));
  const [emailSendetGerade, setEmailSendetGerade] = useState(false);
  const [emailFehler, setEmailFehler] = useState(null);
  const [emailGesendet, setEmailGesendet] = useState(false);
  const [mitKalenderanhang, setMitKalenderanhang] = useState(true);
  const [emailVerlauf, setEmailVerlauf] = useState([]);
  const [notizen, setNotizen] = useState([]);
  const [neueNotiz, setNeueNotiz] = useState('');
  const [notizSpeichertGerade, setNotizSpeichertGerade] = useState(false);

  useEffect(() => {
    if (pendenz) api.mail.status().then((s) => setMailKonfiguriert(s.konfiguriert)).catch(() => setMailKonfiguriert(false));
  }, [pendenz]);

  const ladeEmailVerlauf = useCallback(() => {
    if (!pendenz) return;
    api.pendenzen.emails(pendenz.id).then(setEmailVerlauf).catch(() => {});
  }, [pendenz]);

  useEffect(ladeEmailVerlauf, [ladeEmailVerlauf]);

  const ladeNotizen = useCallback(() => {
    if (!pendenz) return;
    api.pendenzen.notizen(pendenz.id).then(setNotizen).catch(() => {});
  }, [pendenz]);

  useEffect(ladeNotizen, [ladeNotizen]);

  // Kein eigenes <form> (laege sonst verschachtelt im Pendenz-Formular -- ungueltiges HTML, und
  // Enter haette das falsche Formular abgeschickt).
  async function notizHinzufuegen() {
    if (!neueNotiz.trim() || !pendenz) return;
    setNotizSpeichertGerade(true);
    try {
      await api.pendenzen.notizErstellen(pendenz.id, neueNotiz.trim());
      setNeueNotiz('');
      ladeNotizen();
    } catch (err) {
      setFehler(err.message);
    } finally {
      setNotizSpeichertGerade(false);
    }
  }

  async function notizLoeschen(notiz) {
    await api.pendenzen.notizLoeschen(pendenz.id, notiz.id);
    ladeNotizen();
  }

  async function emailSenden(e) {
    e.preventDefault();
    setEmailSendetGerade(true);
    setEmailFehler(null);
    try {
      const payload = { ...emailFormular, pendenzId: pendenz?.id };
      if (mitKalenderanhang && pendenz && pendenz.faelligkeit) {
        payload.kalender = { titel: pendenz.titel, beschreibung: pendenz.beschreibung, faelligkeit: pendenz.faelligkeit };
      }
      await api.mail.senden(payload);
      setEmailGesendet(true);
      setEmailOffen(false);
      ladeEmailVerlauf();
    } catch (err) {
      setEmailFehler(err.message);
    } finally {
      setEmailSendetGerade(false);
    }
  }

  function feldAendern(name, wert) {
    setFormular((f) => ({ ...f, [name]: wert }));
  }

  function titelAendern(wert) {
    if (blockManuell) { feldAendern('titel', wert); return; }
    const vorschlag = blockVorschlag(wert);
    // Passt kein Stichwort mehr, faellt ein zuvor nur VORGESCHLAGENER Block auf "Sonstiges"
    // zurueck; ein von Anfang an gesetzter Block (z.B. aus einer Vorgabe) bleibt stehen.
    setFormular((f) => ({ ...f, titel: wert, block: vorschlag || (blockVorgeschlagen ? 'Sonstiges' : f.block) }));
    setBlockVorgeschlagen(!!vorschlag);
  }

  function blockAendern(wert) {
    setBlockManuell(true);
    setBlockVorgeschlagen(false);
    feldAendern('block', wert);
  }

  // Pflichtfelder beim Erfassen/Einplanen: Mandant, naechster Schritt, Frist, Aufwand,
  // Prioritaet. Ein Projekt-Kopf braucht keinen eigenen Aufwand -- der steckt in den Schritten.
  function pflichtfelderPruefen() {
    const fehlend = [];
    if (formular.mandantId === '') fehlend.push('Mandant (oder «Intern»)');
    if (!formular.titel.trim()) fehlend.push('nächster Schritt');
    if (formular.aufwandMinuten === '' && !istProjekt) fehlend.push('Aufwand');
    if (!formular.prioritaet) fehlend.push('Priorität');
    if (fehlend.length) return `Bitte noch ausfüllen: ${fehlend.join(', ')}.`;
    if (formular.status === 'Warten auf' && (!formular.wartenAufPerson.trim() || !formular.wiedervorlage)) {
      return 'Status «Warten auf» braucht eine Person und ein Nachfassdatum.';
    }
    return null;
  }

  async function speichern(e) {
    e.preventDefault();
    const pflichtFehler = pflichtfelderPruefen();
    if (pflichtFehler) { setFehler(pflichtFehler); return; }

    const wartet = formular.status === 'Warten auf';
    let bearbeiterId = formular.bearbeiterId === '' ? null : Number(formular.bearbeiterId);
    const wirdInArbeit = formular.status === 'In Arbeit' && pendenz?.status !== 'In Arbeit';
    if (formular.status === 'In Arbeit' && bearbeiterId == null && benutzer?.id) bearbeiterId = benutzer.id;

    setSpeichertGerade(true);
    setFehler(null);
    if (wirdInArbeit && !istProjekt && !(await inArbeitErlaubt(pendenz, bearbeiterId))) {
      setSpeichertGerade(false);
      return;
    }

    const payload = {
      titel: formular.titel.trim(),
      mandantId: mandantFuerSpeichern(formular.mandantId),
      bearbeiterId,
      beschreibung: formular.beschreibung.trim() || null,
      faelligkeit: formular.faelligkeit || null,
      harteFrist: formular.harteFrist,
      prioritaet: formular.prioritaet,
      status: formular.status,
      aufwandMinuten: formular.aufwandMinuten === '' ? null : Number(formular.aufwandMinuten),
      leistungId: formular.leistungId === '' ? null : Number(formular.leistungId),
      block: formular.block,
      // Ausserhalb von "Warten auf" IMMER auf null zuruecksetzen (nicht nur wenn leer) -- sonst
      // bleibt ein frueher gesetztes Nachfassdatum im Hintergrund gespeichert (das Feld ist dann
      // nur ausgeblendet, formular.wiedervorlage aber weiterhin befuellt) und taucht beim
      // naechsten Wechsel zurueck auf "Warten auf" faelschlich sofort wieder mit dem alten
      // Datum in "Nachfassen" auf.
      wartenAufPerson: wartet ? formular.wartenAufPerson.trim() : null,
      warteSeit: wartet ? (formular.warteSeit || heutigesDatumISO()) : null,
      wiedervorlage: wartet ? formular.wiedervorlage : null,
      bearbeitungstag: formular.bearbeitungstag || null,
    };

    try {
      const ergebnis = pendenz
        ? await api.pendenzen.aktualisieren(pendenz.id, payload)
        : await api.pendenzen.erstellen(payload);
      meldeAenderung();
      onGespeichert(ergebnis);
    } catch (err) {
      setFehler(err.message);
      setSpeichertGerade(false);
    }
  }

  async function loeschen() {
    if (!pendenz) return;
    if (!window.confirm(`"${pendenz.titel}" wirklich löschen?`)) return;
    setSpeichertGerade(true);
    try {
      await api.pendenzen.loeschen(pendenz.id);
      meldeAenderung();
      onGeloescht(pendenz);
    } catch (err) {
      setFehler(err.message);
      setSpeichertGerade(false);
    }
  }

  return (
    <div className="modal-hintergrund" onClick={onSchliessen}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-kopf">
          <span>{pendenz ? `Pendenz ${pendenz.id} bearbeiten` : 'Neue Pendenz'}</span>
          <button type="button" className="modal-schliessen" onClick={onSchliessen} aria-label="Schliessen">×</button>
        </div>

        <form onSubmit={speichern} noValidate>
          <div className="modal-koerper">
            {pendenz && !istProjekt && <PendenzZeit pendenz={pendenz} kompakt />}
            <div className="feld">
              <label htmlFor="titel" className="label-mit-diktat">
                Nächster Schritt *
                <DiktatKnopf titel="Nächsten Schritt diktieren" onText={(t) => setFormular((f) => ({ ...f, titel: textAnhaengen(f.titel, t) }))} />
              </label>
              <input
                id="titel"
                ref={titelRef}
                type="text"
                value={formular.titel}
                onChange={(e) => titelAendern(e.target.value)}
                placeholder="Verb + Objekt, z.B. «MWST-Abrechnung Q3 in Abacus abstimmen»"
              />
              <p className="feld-hinweis">Ein konkreter Schritt, kein Thema – was tust du als Nächstes?</p>
            </div>

            <div className="feld">
              <label htmlFor="mandant">Mandant *</label>
              <select id="mandant" value={formular.mandantId} onChange={(e) => feldAendern('mandantId', e.target.value)}>
                <option value="">– bitte wählen –</option>
                <option value={INTERN}>Intern (eigenes Büro)</option>
                {mandanten.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <AblageKnoepfe mandant={mandanten.find((m) => String(m.id) === String(formular.mandantId))} />
            </div>

            <div className="feld-reihe">
              <div className="feld">
                <label htmlFor="faelligkeit">Frist (nur bei echtem Termin)</label>
                <input
                  id="faelligkeit"
                  type="date"
                  value={formular.faelligkeit}
                  onChange={(e) => feldAendern('faelligkeit', e.target.value)}
                />
                <label className="feld-checkbox">
                  <input type="checkbox" checked={formular.harteFrist} onChange={(e) => feldAendern('harteFrist', e.target.checked)} />
                  Harte Frist (Behörde/Zahlung)
                </label>
              </div>
              <div className="feld">
                <label htmlFor="bearbeitungstag">Bearbeiten am (geplant)</label>
                <input
                  id="bearbeitungstag"
                  type="date"
                  value={formular.bearbeitungstag}
                  onChange={(e) => feldAendern('bearbeitungstag', e.target.value)}
                />
                <p className="feld-hinweis">Wann du als Nächstes daran arbeitest – unabhängig von der Frist.</p>
              </div>
            </div>

            <div className="feld-reihe">
              <div className="feld">
                <label htmlFor="prioritaet">Priorität *</label>
                <select id="prioritaet" value={formular.prioritaet} onChange={(e) => feldAendern('prioritaet', e.target.value)}>
                  {PRIORITAETEN.map((p) => <option key={p} value={p}>{PRIORITAET_BESCHREIBUNG[p]}</option>)}
                </select>
                {prioVorschlag && prioVorschlag !== formular.prioritaet && (
                  <button type="button" className="feld-vorschlag" onClick={() => feldAendern('prioritaet', prioVorschlag)}>
                    Vorschlag: {prioVorschlag} – harte Frist in ≤ 5 Arbeitstagen übernehmen
                  </button>
                )}
              </div>
              <div className="feld">
                <label htmlFor="aufwand">Aufwand{istProjekt ? '' : ' *'}</label>
                <select id="aufwand" value={formular.aufwandMinuten} onChange={(e) => feldAendern('aufwandMinuten', e.target.value)}>
                  <option value="">{istProjekt ? '– steckt in den Schritten –' : '– bitte wählen –'}</option>
                  {AUFWAND_MINUTEN.map((m) => <option key={m} value={m}>{formatiereAufwand(m)}</option>)}
                </select>
              </div>
            </div>

            <div className="feld">
              <label htmlFor="pendenz-leistung">Leistung (Zeiterfassung)</label>
              <select id="pendenz-leistung" value={formular.leistungId} onChange={(e) => feldAendern('leistungId', e.target.value)}>
                <option value="">– keine –</option>
                {leistungen.filter((l) => l.aktiv || String(l.id) === String(formular.leistungId)).map((l) => <option key={l.id} value={String(l.id)}>{l.name}</option>)}
              </select>
              <p className="feld-hinweis">Wird beim Erfassen der Zeit vorgeschlagen – daraus ergibt sich, ob die Arbeit in der Pauschale ist.</p>
            </div>

            <div className="feld-reihe">
              <div className="feld">
                <label htmlFor="status">Status</label>
                <select id="status" value={formular.status} onChange={(e) => feldAendern('status', e.target.value)}>
                  {STATUS_WERTE.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="feld">
                <label htmlFor="block">Block{blockVorgeschlagen ? ' (vorgeschlagen)' : ''}</label>
                <select id="block" value={formular.block} onChange={(e) => blockAendern(e.target.value)}>
                  {BLOECKE.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            </div>

            {formular.status === 'Warten auf' && (
              <div className="feld-reihe">
                <div className="feld">
                  <label htmlFor="wartenAufPerson">Warten auf (Person) *</label>
                  <input
                    id="wartenAufPerson"
                    type="text"
                    value={formular.wartenAufPerson}
                    onChange={(e) => feldAendern('wartenAufPerson', e.target.value)}
                    placeholder="z.B. Kunde Hr. Muster, Steueramt"
                  />
                </div>
                <div className="feld">
                  <label htmlFor="wiedervorlage">Nachfassdatum *</label>
                  <input id="wiedervorlage" type="date" value={formular.wiedervorlage} onChange={(e) => feldAendern('wiedervorlage', e.target.value)} />
                </div>
              </div>
            )}

            <div className="feld">
              <label htmlFor="bearbeiter">Bearbeiter/in</label>
              <select id="bearbeiter" value={formular.bearbeiterId} onChange={(e) => feldAendern('bearbeiterId', e.target.value)}>
                <option value="">Nicht zugewiesen</option>
                {mitarbeitende.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>

            <div className="feld">
              <label htmlFor="beschreibung" className="label-mit-diktat">
                Beschreibung
                <DiktatKnopf titel="Beschreibung diktieren" onText={(t) => setFormular((f) => ({ ...f, beschreibung: textAnhaengen(f.beschreibung, t) }))} />
              </label>
              <textarea id="beschreibung" value={formular.beschreibung} onChange={(e) => feldAendern('beschreibung', e.target.value)} />
            </div>

            {pendenz?.zuletzt_geaendert_am && (
              <p className="feld-hinweis">
                Erstellt {formatiereZeitstempel(pendenz.erstellt_am)} · zuletzt geändert {formatiereZeitstempel(pendenz.zuletzt_geaendert_am)}
                {pendenz.erledigt_am ? ` · erledigt ${formatiereDatum(pendenz.erledigt_am)}` : ''}
              </p>
            )}

            {pendenz && (
              <div className="feld">
                <label>Kalender</label>
                <button type="button" className="btn-klein" style={{ width: 'fit-content' }} onClick={() => ladeICSHerunter(pendenz)}>
                  📅 In Kalender speichern (.ics)
                </button>
              </div>
            )}

            {pendenz && mailKonfiguriert !== null && (
              <div className="feld">
                <label>E-Mail</label>
                {emailVerlauf.length > 0 && (
                  <div className="email-verlauf">
                    {emailVerlauf.map((e) => (
                      <div key={e.id} className="email-verlauf-eintrag">
                        <span className="email-verlauf-symbol" aria-hidden="true">✔</span>
                        <span>Gesendet am {formatiereZeitstempel(e.gesendet_am)} an <strong>{e.an}</strong></span>
                      </div>
                    ))}
                  </div>
                )}
                {!mailKonfiguriert && (
                  <p className="teilaufgaben-hinweis">
                    E-Mail-Versand ist noch nicht eingerichtet – unter „Einstellungen" hinterlegen.
                  </p>
                )}
                {mailKonfiguriert && !emailOffen && (
                  <button type="button" className="btn-klein" onClick={() => { setEmailOffen(true); setEmailGesendet(false); }}>
                    ✉ E-Mail senden
                  </button>
                )}
                {mailKonfiguriert && emailGesendet && !emailOffen && (
                  <p className="teilaufgaben-hinweis" style={{ color: 'var(--success)' }}>E-Mail wurde gesendet.</p>
                )}
                {emailOffen && (
                  <div className="email-formular">
                    {(ausgewaehlterMandant?.email || ausgewaehlterMandant?.geschaeftsfuehrung_email || ausgewaehlterBearbeiter?.email) && (
                      <div className="email-empfaenger-auswahl">
                        {ausgewaehlterMandant?.email && (
                          <button type="button" className="btn-klein" onClick={() => setEmailFormular((f) => ({ ...f, an: ausgewaehlterMandant.email }))}>
                            Ansprechpartner/in
                          </button>
                        )}
                        {ausgewaehlterMandant?.geschaeftsfuehrung_email && (
                          <button type="button" className="btn-klein" onClick={() => setEmailFormular((f) => ({ ...f, an: ausgewaehlterMandant.geschaeftsfuehrung_email }))}>
                            Geschäftsführung
                          </button>
                        )}
                        {ausgewaehlterBearbeiter?.email && (
                          <button type="button" className="btn-klein" onClick={() => setEmailFormular((f) => ({ ...f, an: ausgewaehlterBearbeiter.email }))}>
                            {ausgewaehlterBearbeiter.name || 'Bearbeiter/in'}
                          </button>
                        )}
                      </div>
                    )}
                    <input
                      type="email"
                      placeholder="Empfänger-E-Mail"
                      value={emailFormular.an}
                      onChange={(e) => setEmailFormular((f) => ({ ...f, an: e.target.value }))}
                    />
                    <input
                      type="text"
                      placeholder="Betreff"
                      value={emailFormular.betreff}
                      onChange={(e) => setEmailFormular((f) => ({ ...f, betreff: e.target.value }))}
                    />
                    <textarea
                      value={emailFormular.text}
                      onChange={(e) => setEmailFormular((f) => ({ ...f, text: e.target.value }))}
                      rows={5}
                    />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-muted)' }}>
                      <input type="checkbox" checked={mitKalenderanhang} onChange={(e) => setMitKalenderanhang(e.target.checked)} />
                      Als Kalendertermin anhängen (.ics) – Empfänger kann es direkt in Outlook übernehmen
                    </label>
                    {emailFehler && <div className="hinweis-fehler">{emailFehler}</div>}
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button type="button" className="btn" onClick={() => setEmailOffen(false)}>Abbrechen</button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={emailSenden}
                        disabled={emailSendetGerade || !emailFormular.an.trim() || !emailFormular.betreff.trim() || !emailFormular.text.trim()}
                      >
                        {emailSendetGerade ? 'Sende…' : 'Senden'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {istHauptaufgabe && (
              <div className="feld">
                <label>
                  Schritte (Projekt)
                  {teilaufgaben.length > 0 && (
                    <span className="teilaufgaben-zaehler">
                      {teilaufgaben.filter((t) => t.status === 'Erledigt').length}/{teilaufgaben.length} erledigt
                    </span>
                  )}
                </label>
                {(projektModus || teilaufgaben.length > 0) && (
                  <p className="feld-hinweis">
                    Schritte in der richtigen Reihenfolge erfassen – nur der erste offene ist aktiv, die weiteren
                    stehen auf «Später» und rücken automatisch nach, sobald einer erledigt ist.
                  </p>
                )}
                <div className="teilaufgaben-liste">
                  {teilaufgaben.map((t, idx) => {
                    const erledigt = t.status === 'Erledigt';
                    return (
                      <div key={t.id} className={`teilaufgabe-zeile ${erledigt ? 'erledigt' : ''}`}>
                        <button
                          type="button"
                          className={`abhaken ${erledigt ? 'aktiv' : ''}`}
                          aria-label={erledigt ? 'Als offen markieren' : 'Als erledigt markieren'}
                          onClick={() => teilaufgabeStatusAendern(t, erledigt ? 'Offen' : 'Erledigt')}
                        >
                          {erledigt ? '✓' : ''}
                        </button>
                        <span className="teilaufgabe-titel" title={t.titel}><span className="zeile-id">{pendenz.id}.{idx + 1}</span>{t.titel}</span>
                        {!erledigt && <span className={`zeile-status-tag status-${statusSlug(t.status)}`}>{t.status}</span>}
                        <span className="teilaufgabe-datum">{formatiereDatum(t.faelligkeit)}</span>
                        <button type="button" className="teilaufgabe-verschieben" title="Nach oben" aria-label="Schritt nach oben" disabled={idx === 0} onClick={() => teilaufgabeVerschieben(idx, -1)}>↑</button>
                        <button type="button" className="teilaufgabe-verschieben" title="Nach unten" aria-label="Schritt nach unten" disabled={idx === teilaufgaben.length - 1} onClick={() => teilaufgabeVerschieben(idx, 1)}>↓</button>
                        <button type="button" className="teilaufgabe-kalender" title="In Kalender speichern (.ics)" aria-label="In Kalender speichern" onClick={() => ladeICSHerunter(t)}>📅</button>
                        <button type="button" className="teilaufgabe-loeschen" aria-label="Schritt löschen" onClick={() => teilaufgabeLoeschen(t)}>×</button>
                      </div>
                    );
                  })}
                  {teilaufgaben.length === 0 && <div className="teilaufgaben-leer">Noch keine Schritte – eine einzelne Pendenz braucht keine.</div>}
                </div>
                <div className="teilaufgabe-neu">
                  <input
                    type="text"
                    placeholder="Neuer Schritt (Verb + Objekt)…"
                    value={neueTeilaufgabe.titel}
                    onChange={(e) => setNeueTeilaufgabe((n) => ({ ...n, titel: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); teilaufgabeHinzufuegen(); } }}
                  />
                  <div className="teilaufgabe-neu-zeile2">
                    <input
                      type="date"
                      value={neueTeilaufgabe.faelligkeit}
                      onChange={(e) => setNeueTeilaufgabe((n) => ({ ...n, faelligkeit: e.target.value }))}
                    />
                    <button type="button" className="btn-klein" onClick={teilaufgabeHinzufuegen}>+ Hinzufügen</button>
                  </div>
                </div>
              </div>
            )}

            {!pendenz && (
              <p className="teilaufgaben-hinweis">Schritte (Projekt) können hinzugefügt werden, sobald die Pendenz gespeichert ist.</p>
            )}

            {pendenz && (
              <div className="feld">
                <label>Fortschritt</label>
                <div className="notizen-liste">
                  {notizen.map((n) => (
                    <div key={n.id} className="notiz-eintrag">
                      <div className="notiz-kopf">
                        <span className="notiz-datum">{formatiereZeitstempel(n.erstellt_am)}</span>
                        {n.mitarbeiter_name && <span className="notiz-autor">{n.mitarbeiter_name}</span>}
                        <button type="button" className="notiz-loeschen" aria-label="Notiz löschen" onClick={() => notizLoeschen(n)}>×</button>
                      </div>
                      <p className="notiz-text">{n.text}</p>
                    </div>
                  ))}
                  {notizen.length === 0 && <div className="teilaufgaben-leer">Noch keine Einträge – dokumentiere hier, was bereits erledigt wurde.</div>}
                </div>
                <div className="notiz-neu">
                  <textarea
                    placeholder="z.B. Lohnausweise erstellt, warte auf Rückmeldung Kunde…"
                    value={neueNotiz}
                    onChange={(e) => setNeueNotiz(e.target.value)}
                    rows={2}
                  />
                  <button type="button" className="btn-klein" onClick={notizHinzufuegen} disabled={!neueNotiz.trim() || notizSpeichertGerade}>
                    + Eintrag hinzufügen
                  </button>
                </div>
              </div>
            )}

            {fehler && <div className="hinweis-fehler">{fehler}</div>}
          </div>

          <div className="modal-fuss">
            <div>
              {pendenz && (
                <button type="button" className="btn btn-gefahr" onClick={loeschen} disabled={speichertGerade}>
                  Löschen
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn" onClick={onSchliessen}>Abbrechen</button>
              <button type="submit" className="btn btn-primary" disabled={speichertGerade}>
                {pendenz ? (pendenz.geplant === false ? 'Einplanen' : 'Speichern') : 'Erfassen'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
