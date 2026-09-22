import { useCallback, useEffect, useRef, useState } from 'react';
import { STATUS_WERTE, PRIORITAETEN } from '../constants.js';
import { formatiereDatum, formatiereZeitstempel, heutigesDatumISO } from '../format.js';
import api from '../api.js';
import { meldeAenderung } from '../events.js';
import { ladeICSHerunter } from '../lib/ics.js';

function leeresFormular(vorgabe) {
  return {
    titel: '',
    mandantId: '',
    bearbeiterId: '',
    beschreibung: '',
    faelligkeit: heutigesDatumISO(),
    prioritaet: 'Mittel',
    status: 'Offen',
    aufwandStunden: '',
    warteSeit: '',
    wiedervorlage: '',
    ...vorgabe,
  };
}

function ausPendenz(pendenz) {
  return {
    titel: pendenz.titel,
    mandantId: pendenz.mandant_id ?? '',
    bearbeiterId: pendenz.bearbeiter_id ?? '',
    beschreibung: pendenz.beschreibung ?? '',
    faelligkeit: pendenz.faelligkeit,
    prioritaet: pendenz.prioritaet,
    status: pendenz.status,
    aufwandStunden: pendenz.aufwand_stunden ?? '',
    warteSeit: pendenz.warte_seit ?? '',
    wiedervorlage: pendenz.wiedervorlage ?? '',
  };
}

// Ein Modal fuer Schnellerfassung (pendenz=null) und vollstaendiges Bearbeiten (pendenz gesetzt).
export default function PendenzModal({ pendenz, mandanten, mitarbeitende = [], vorgabe, onSchliessen, onGespeichert, onGeloescht }) {
  const [formular, setFormular] = useState(() => (pendenz ? ausPendenz(pendenz) : leeresFormular(vorgabe)));
  const [speichertGerade, setSpeichertGerade] = useState(false);
  const [fehler, setFehler] = useState(null);
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

  const ladeTeilaufgaben = useCallback(() => {
    if (!istHauptaufgabe) return;
    api.pendenzen.teilaufgaben(pendenz.id).then(setTeilaufgaben).catch(() => {});
  }, [istHauptaufgabe, pendenz]);

  useEffect(() => {
    titelRef.current?.focus();
    ladeTeilaufgaben();
  }, [ladeTeilaufgaben]);

  async function teilaufgabeStatusAendern(teilaufgabe, neuerStatus) {
    await api.pendenzen.statusAendern(teilaufgabe.id, neuerStatus);
    meldeAenderung();
    ladeTeilaufgaben();
  }

  async function teilaufgabeLoeschen(teilaufgabe) {
    await api.pendenzen.loeschen(teilaufgabe.id);
    meldeAenderung();
    ladeTeilaufgaben();
  }

  async function teilaufgabeHinzufuegen(e) {
    e.preventDefault();
    if (!neueTeilaufgabe.titel.trim() || !neueTeilaufgabe.faelligkeit) return;
    await api.pendenzen.erstellen({
      titel: neueTeilaufgabe.titel.trim(),
      faelligkeit: neueTeilaufgabe.faelligkeit,
      mandantId: formular.mandantId === '' ? null : Number(formular.mandantId),
      prioritaet: 'Mittel',
      status: 'Offen',
      uebergeordnetePendenzId: pendenz.id,
    });
    meldeAenderung();
    setNeueTeilaufgabe({ titel: '', faelligkeit: formular.faelligkeit });
    ladeTeilaufgaben();
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
      ? `Guten Tag\n\nBetrifft "${pendenz.titel}" (faellig am ${formatiereDatum(pendenz.faelligkeit)}).\n\nFreundliche Gruesse`
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

  async function notizHinzufuegen(e) {
    e.preventDefault();
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
      if (mitKalenderanhang && pendenz) {
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

  async function speichern(e) {
    e.preventDefault();
    if (!formular.titel.trim()) { setFehler('Titel ist erforderlich'); return; }
    if (!formular.faelligkeit) { setFehler('Faelligkeitsdatum ist erforderlich'); return; }

    const payload = {
      titel: formular.titel.trim(),
      mandantId: formular.mandantId === '' ? null : Number(formular.mandantId),
      bearbeiterId: formular.bearbeiterId === '' ? null : Number(formular.bearbeiterId),
      beschreibung: formular.beschreibung.trim() || null,
      faelligkeit: formular.faelligkeit,
      prioritaet: formular.prioritaet,
      status: formular.status,
      aufwandStunden: formular.aufwandStunden === '' ? null : Number(formular.aufwandStunden),
      // Ausserhalb von "Warte auf Kunde" IMMER auf null zuruecksetzen (nicht nur wenn leer) --
      // sonst bleibt ein frueher gesetztes Wiedervorlage-Datum im Hintergrund gespeichert (das
      // Feld ist dann nur ausgeblendet, formular.wiedervorlage aber weiterhin befuellt) und
      // taucht beim naechsten Wechsel zurueck auf "Warte auf Kunde" faelschlich sofort wieder
      // mit dem alten Datum in "Nachfassen" auf.
      warteSeit: formular.status === 'Warte auf Kunde' ? (formular.warteSeit || heutigesDatumISO()) : null,
      wiedervorlage: formular.status === 'Warte auf Kunde' ? (formular.wiedervorlage || null) : null,
    };

    setSpeichertGerade(true);
    setFehler(null);
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
    if (!window.confirm(`"${pendenz.titel}" wirklich loeschen?`)) return;
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

        <form onSubmit={speichern}>
          <div className="modal-koerper">
            <div className="feld">
              <label htmlFor="titel">Titel *</label>
              <input
                id="titel"
                ref={titelRef}
                type="text"
                value={formular.titel}
                onChange={(e) => feldAendern('titel', e.target.value)}
                placeholder="z.B. MWST-Abrechnung Q3 einreichen"
                required
              />
            </div>

            <div className="feld-reihe">
              <div className="feld">
                <label htmlFor="faelligkeit">Faelligkeit *</label>
                <input
                  id="faelligkeit"
                  type="date"
                  value={formular.faelligkeit}
                  onChange={(e) => feldAendern('faelligkeit', e.target.value)}
                  required
                />
              </div>
              <div className="feld">
                <label htmlFor="mandant">Mandant</label>
                <select id="mandant" value={formular.mandantId} onChange={(e) => feldAendern('mandantId', e.target.value)}>
                  <option value="">Kein Mandant (intern)</option>
                  {mandanten.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="feld-reihe">
              <div className="feld">
                <label htmlFor="prioritaet">Prioritaet</label>
                <select id="prioritaet" value={formular.prioritaet} onChange={(e) => feldAendern('prioritaet', e.target.value)}>
                  {PRIORITAETEN.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="feld">
                <label htmlFor="status">Status</label>
                <select id="status" value={formular.status} onChange={(e) => feldAendern('status', e.target.value)}>
                  {STATUS_WERTE.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div className="feld">
              <label htmlFor="bearbeiter">Bearbeiter/in</label>
              <select id="bearbeiter" value={formular.bearbeiterId} onChange={(e) => feldAendern('bearbeiterId', e.target.value)}>
                <option value="">Nicht zugewiesen</option>
                {mitarbeitende.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>

            {formular.status === 'Warte auf Kunde' && (
              <div className="feld-reihe">
                <div className="feld">
                  <label htmlFor="warteSeit">Warte seit</label>
                  <input id="warteSeit" type="date" value={formular.warteSeit} onChange={(e) => feldAendern('warteSeit', e.target.value)} />
                </div>
                <div className="feld">
                  <label htmlFor="wiedervorlage">Wiedervorlage (Nachfassen)</label>
                  <input id="wiedervorlage" type="date" value={formular.wiedervorlage} onChange={(e) => feldAendern('wiedervorlage', e.target.value)} />
                </div>
              </div>
            )}

            <div className="feld">
              <label htmlFor="beschreibung">Beschreibung</label>
              <textarea id="beschreibung" value={formular.beschreibung} onChange={(e) => feldAendern('beschreibung', e.target.value)} />
            </div>

            <div className="feld">
              <label htmlFor="aufwand">Aufwandschaetzung (Stunden)</label>
              <input
                id="aufwand"
                type="number"
                step="0.25"
                min="0"
                value={formular.aufwandStunden}
                onChange={(e) => feldAendern('aufwandStunden', e.target.value)}
              />
            </div>

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
                      placeholder="Empfaenger-E-Mail"
                      value={emailFormular.an}
                      onChange={(e) => setEmailFormular((f) => ({ ...f, an: e.target.value }))}
                      required
                    />
                    <input
                      type="text"
                      placeholder="Betreff"
                      value={emailFormular.betreff}
                      onChange={(e) => setEmailFormular((f) => ({ ...f, betreff: e.target.value }))}
                      required
                    />
                    <textarea
                      value={emailFormular.text}
                      onChange={(e) => setEmailFormular((f) => ({ ...f, text: e.target.value }))}
                      rows={5}
                      required
                    />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-muted)' }}>
                      <input type="checkbox" checked={mitKalenderanhang} onChange={(e) => setMitKalenderanhang(e.target.checked)} />
                      Als Kalendertermin anhängen (.ics) – Empfänger kann es direkt in Outlook übernehmen
                    </label>
                    {emailFehler && <div className="hinweis-fehler">{emailFehler}</div>}
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button type="button" className="btn" onClick={() => setEmailOffen(false)}>Abbrechen</button>
                      <button type="button" className="btn btn-primary" onClick={emailSenden} disabled={emailSendetGerade}>
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
                  Teilaufgaben
                  {teilaufgaben.length > 0 && (
                    <span className="teilaufgaben-zaehler">
                      {teilaufgaben.filter((t) => t.status === 'Erledigt').length}/{teilaufgaben.length} erledigt
                    </span>
                  )}
                </label>
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
                        <span className="teilaufgabe-datum">{formatiereDatum(t.faelligkeit)}</span>
                        <button type="button" className="teilaufgabe-kalender" title="In Kalender speichern (.ics)" aria-label="In Kalender speichern" onClick={() => ladeICSHerunter(t)}>📅</button>
                        <button type="button" className="teilaufgabe-loeschen" aria-label="Teilaufgabe loeschen" onClick={() => teilaufgabeLoeschen(t)}>×</button>
                      </div>
                    );
                  })}
                  {teilaufgaben.length === 0 && <div className="teilaufgaben-leer">Noch keine Teilaufgaben.</div>}
                </div>
                <div className="teilaufgabe-neu">
                  <input
                    type="text"
                    placeholder="Neue Teilaufgabe…"
                    value={neueTeilaufgabe.titel}
                    onChange={(e) => setNeueTeilaufgabe((n) => ({ ...n, titel: e.target.value }))}
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
              <p className="teilaufgaben-hinweis">Teilaufgaben können hinzugefügt werden, sobald die Pendenz gespeichert ist.</p>
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
                <form className="notiz-neu" onSubmit={notizHinzufuegen}>
                  <textarea
                    placeholder="z.B. Lohnausweise erstellt, warte auf Rückmeldung Kunde…"
                    value={neueNotiz}
                    onChange={(e) => setNeueNotiz(e.target.value)}
                    rows={2}
                  />
                  <button type="submit" className="btn-klein" disabled={!neueNotiz.trim() || notizSpeichertGerade}>
                    + Eintrag hinzufügen
                  </button>
                </form>
              </div>
            )}

            {fehler && <div className="hinweis-fehler">{fehler}</div>}
          </div>

          <div className="modal-fuss">
            <div>
              {pendenz && (
                <button type="button" className="btn btn-gefahr" onClick={loeschen} disabled={speichertGerade}>
                  Loeschen
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn" onClick={onSchliessen}>Abbrechen</button>
              <button type="submit" className="btn btn-primary" disabled={speichertGerade}>
                {pendenz ? 'Speichern' : 'Erfassen'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
