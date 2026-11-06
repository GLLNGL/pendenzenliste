import { useEffect, useRef, useState } from 'react';
import api from '../api.js';
import { meldeAenderung } from '../events.js';
import { useAuth } from '../AuthContext.jsx';
import { useLeistungen } from '../hooks.js';
import { PRIORITAETEN, PRIORITAET_BESCHREIBUNG, AUFWAND_MINUTEN, formatiereAufwand, formatiereStunden } from '../constants.js';
import AblageKnoepfe from './AblageKnoepfe.jsx';
import DiktatKnopf from './DiktatKnopf.jsx';
import { textAnhaengen } from '../lib/diktat.js';
import { PendenzDetailModal } from './PendenzModal.jsx';

const INTERN = 'intern';
const VERRECHNUNG = [
  { wert: 'pauschal', label: 'Pauschal' },
  { wert: 'extra', label: 'Extra (Spezialtarif)' },
];
let zaehler = 0;
const neueZeile = (verrechnung = 'pauschal', bearbeitungstag = '') => ({
  _k: `neu-${++zaehler}`, id: null, titel: '', bearbeitungstag, aufwandMinuten: '', verrechnung, status: 'Offen',
});

// Projekt-Fenster (v7): eine neue Pendenz ist ein Projekt. Im Projekt nur Mandant, Bearbeiter,
// Prioritaet, Frist (abschliessen bis) und Verrechnung; die Arbeit steckt in den Teilschritten --
// je eine Zeile mit eigenem Bearbeitungsdatum, Aufwand und Verrechnung. Der Aufwand des Projekts
// ist die Summe der Teilschritte.
export default function ProjektModal({ pendenz, mandanten, mitarbeitende = [], vorgabe, onSchliessen, onGespeichert, onGeloescht }) {
  const { benutzer } = useAuth();
  const leistungen = useLeistungen();
  const [kopf, setKopf] = useState(() => ({
    titel: pendenz?.titel ?? '',
    mandantId: pendenz ? (pendenz.mandant_id == null ? INTERN : String(pendenz.mandant_id)) : (vorgabe?.mandantId ? String(vorgabe.mandantId) : ''),
    bearbeiterId: pendenz ? String(pendenz.bearbeiter_id ?? '') : String(benutzer?.id ?? ''),
    prioritaet: pendenz?.prioritaet ?? 'B',
    faelligkeit: pendenz?.faelligkeit ?? vorgabe?.faelligkeit ?? '',
    harteFrist: !!pendenz?.harte_frist,
    verrechnung: pendenz?.verrechnung ?? 'pauschal',
    leistungId: pendenz?.leistung_id == null ? '' : String(pendenz.leistung_id),
    beschreibung: pendenz?.beschreibung ?? '',
  }));
  const [schritte, setSchritte] = useState(() => (pendenz ? [] : [neueZeile('pauschal', vorgabe?.bearbeitungstag ?? '')]));
  const [geloescht, setGeloescht] = useState([]);
  const [geladen, setGeladen] = useState(!pendenz);
  const [fehler, setFehler] = useState(null);
  const [speichert, setSpeichert] = useState(false);
  const [details, setDetails] = useState(false);
  const titelRef = useRef(null);

  useEffect(() => { titelRef.current?.focus(); }, []);

  useEffect(() => {
    if (!pendenz) return;
    api.pendenzen.teilaufgaben(pendenz.id).then((liste) => {
      setSchritte(liste.map((t) => ({
        _k: `id-${t.id}`, id: t.id, titel: t.titel, bearbeitungstag: t.bearbeitungstag ?? '',
        aufwandMinuten: t.aufwand_minuten == null ? '' : String(t.aufwand_minuten), verrechnung: t.verrechnung ?? 'pauschal',
        status: t.status, original: t,
      })));
      setGeladen(true);
    }).catch((e) => { setFehler(e.message); setGeladen(true); });
  }, [pendenz]);

  useEffect(() => {
    function onKeyDown(e) { if (e.key === 'Escape' && !details) onSchliessen(); }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSchliessen, details]);

  const feld = (name, wert) => setKopf((k) => ({ ...k, [name]: wert }));
  const schrittAendern = (k, patch) => setSchritte((liste) => liste.map((s) => (s._k === k ? { ...s, ...patch } : s)));
  function schrittEntfernen(s) {
    if (s.id) setGeloescht((g) => [...g, s.id]);
    setSchritte((liste) => liste.filter((x) => x._k !== s._k));
  }
  const schrittHinzufuegen = () => setSchritte((liste) => [...liste, neueZeile(kopf.verrechnung)]);

  const summe = schritte.filter((s) => s.status !== 'Erledigt').reduce((t, s) => t + (Number(s.aufwandMinuten) || 0), 0);
  const ohneAufwand = schritte.filter((s) => s.titel.trim() && s.status !== 'Erledigt' && !s.aufwandMinuten).length;

  async function speichern(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!kopf.titel.trim()) { setFehler('Bitte einen Titel für das Projekt eingeben.'); return; }
    if (!kopf.mandantId) { setFehler('Bitte den Mandanten wählen (oder «Intern»).'); return; }
    const leereBestehende = schritte.filter((s) => s.id && !s.titel.trim());
    if (leereBestehende.length) { setFehler('Ein bestehender Teilschritt hat keinen Text mehr – Text ergänzen oder mit × entfernen.'); return; }
    if (geloescht.length && !window.confirm(`${geloescht.length} Teilschritt(e) werden gelöscht. Fortfahren?`)) return;

    setSpeichert(true);
    setFehler(null);
    try {
      const mandantId = kopf.mandantId === INTERN ? null : Number(kopf.mandantId);
      const bearbeiterId = kopf.bearbeiterId ? Number(kopf.bearbeiterId) : null;
      const gemeinsam = {
        titel: kopf.titel.trim(), mandantId, bearbeiterId, prioritaet: kopf.prioritaet, faelligkeit: kopf.faelligkeit || null,
        harteFrist: kopf.harteFrist, verrechnung: kopf.verrechnung, leistungId: kopf.leistungId || null, beschreibung: kopf.beschreibung.trim() || null,
      };
      const projekt = pendenz
        ? await api.pendenzen.aktualisieren(pendenz.id, gemeinsam)
        : await api.pendenzen.erstellen({ ...gemeinsam, status: 'Offen' });

      for (const id of geloescht) await api.pendenzen.loeschen(id);
      // Nacheinander, damit die Reihenfolge der Teilschritte erhalten bleibt.
      for (const s of schritte) {
        const daten = {
          titel: s.titel.trim(), bearbeitungstag: s.bearbeitungstag || null, aufwandMinuten: s.aufwandMinuten === '' ? null : Number(s.aufwandMinuten),
          verrechnung: s.verrechnung, mandantId, bearbeiterId, prioritaet: kopf.prioritaet,
        };
        if (s.id) {
          const o = s.original;
          const geaendert = o.titel !== daten.titel || (o.bearbeitungstag ?? null) !== daten.bearbeitungstag
            || (o.aufwand_minuten ?? null) !== daten.aufwandMinuten || (o.verrechnung ?? 'pauschal') !== daten.verrechnung
            || (o.mandant_id ?? null) !== mandantId || (o.bearbeiter_id ?? null) !== bearbeiterId || o.prioritaet !== kopf.prioritaet;
          if (geaendert) await api.pendenzen.aktualisieren(s.id, daten);
        } else if (daten.titel) {
          await api.pendenzen.erstellen({ ...daten, uebergeordnetePendenzId: projekt.id, leistungId: kopf.leistungId || null, status: 'Offen' });
        }
      }
      meldeAenderung();
      onGespeichert?.(projekt);
    } catch (err) {
      setFehler(err.message);
      setSpeichert(false);
    }
  }

  async function loeschen() {
    if (!window.confirm(`Projekt «${pendenz.titel}» mit allen Teilschritten löschen?`)) return;
    try {
      await api.pendenzen.loeschen(pendenz.id);
      meldeAenderung();
      onGeloescht?.();
    } catch (err) {
      setFehler(err.message);
    }
  }

  const mandant = mandanten.find((m) => String(m.id) === kopf.mandantId);

  return (
    <div className="modal-hintergrund" onClick={onSchliessen}>
      <div className="modal modal-breit projekt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-kopf">
          <span>{pendenz ? `Projekt ${pendenz.id} bearbeiten` : 'Neues Projekt'}</span>
          <button type="button" className="modal-schliessen" onClick={onSchliessen} aria-label="Schliessen">×</button>
        </div>
        <form onSubmit={speichern} noValidate>
          <div className="modal-koerper">
            <div className="feld">
              <label htmlFor="pr-titel" className="label-mit-diktat">
                Projekt *
                <DiktatKnopf titel="Titel diktieren" onText={(t) => setKopf((k) => ({ ...k, titel: textAnhaengen(k.titel, t) }))} />
              </label>
              <input id="pr-titel" ref={titelRef} value={kopf.titel} onChange={(e) => feld('titel', e.target.value)} placeholder="z.B. Jahresabschluss 2026" />
            </div>

            <div className="feld-reihe projekt-reihe-3">
              <div className="feld">
                <label htmlFor="pr-mandant">Mandant *</label>
                <select id="pr-mandant" value={kopf.mandantId} onChange={(e) => feld('mandantId', e.target.value)}>
                  <option value="">– bitte wählen –</option>
                  <option value={INTERN}>Intern (eigenes Büro)</option>
                  {mandanten.filter((m) => m.aktiv || String(m.id) === kopf.mandantId).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <AblageKnoepfe mandant={mandant} />
              </div>
              <div className="feld">
                <label htmlFor="pr-bearbeiter">Bearbeiter/in</label>
                <select id="pr-bearbeiter" value={kopf.bearbeiterId} onChange={(e) => feld('bearbeiterId', e.target.value)}>
                  <option value="">– niemand –</option>
                  {mitarbeitende.filter((m) => m.aktiv || String(m.id) === kopf.bearbeiterId).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div className="feld">
                <label htmlFor="pr-prio">Priorität</label>
                <select id="pr-prio" value={kopf.prioritaet} onChange={(e) => feld('prioritaet', e.target.value)}>
                  {PRIORITAETEN.map((p) => <option key={p} value={p}>{PRIORITAET_BESCHREIBUNG[p]}</option>)}
                </select>
              </div>
            </div>

            <div className="feld-reihe projekt-reihe-3">
              <div className="feld">
                <label htmlFor="pr-frist">Abschliessen bis</label>
                <input id="pr-frist" type="date" value={kopf.faelligkeit} onChange={(e) => feld('faelligkeit', e.target.value)} />
                <label className="feld-checkbox">
                  <input type="checkbox" checked={kopf.harteFrist} onChange={(e) => feld('harteFrist', e.target.checked)} />
                  Harte Frist (Behörde/Zahlung)
                </label>
              </div>
              <div className="feld">
                <label htmlFor="pr-verrechnung">Verrechnung</label>
                <select id="pr-verrechnung" value={kopf.verrechnung} onChange={(e) => feld('verrechnung', e.target.value)}>
                  {VERRECHNUNG.map((v) => <option key={v.wert} value={v.wert}>{v.label}</option>)}
                </select>
                <p className="feld-hinweis">Vorgabe für neue Teilschritte.</p>
              </div>
              <div className="feld">
                <label htmlFor="pr-leistung">Leistung</label>
                <select id="pr-leistung" value={kopf.leistungId} onChange={(e) => feld('leistungId', e.target.value)}>
                  <option value="">– keine –</option>
                  {leistungen.filter((l) => l.aktiv || String(l.id) === kopf.leistungId).map((l) => <option key={l.id} value={String(l.id)}>{l.name}</option>)}
                </select>
              </div>
            </div>

            <div className="projekt-schritte">
              <div className="projekt-schritte-kopf">
                <span>Teilschritte</span>
                <span className="projekt-schritte-summe">
                  Aufwand Projekt: <strong>{summe ? formatiereStunden(summe) : '–'}</strong>
                  {ohneAufwand > 0 && ` (${ohneAufwand} ohne Schätzung)`}
                </span>
              </div>
              <table className="tabelle projekt-schritte-tabelle">
                <thead>
                  <tr><th>Teilschritt</th><th>Bearbeiten am</th><th>Aufwand</th><th>Verrechnung</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {schritte.map((s, i) => (
                    <tr key={s._k} className={s.status === 'Erledigt' ? 'erledigt' : ''}>
                      <td>
                        <input
                          value={s.titel}
                          onChange={(e) => schrittAendern(s._k, { titel: e.target.value })}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (i === schritte.length - 1) schrittHinzufuegen(); } }}
                          placeholder="Was ist zu tun?"
                          aria-label="Teilschritt"
                        />
                      </td>
                      <td><input type="date" value={s.bearbeitungstag} onChange={(e) => schrittAendern(s._k, { bearbeitungstag: e.target.value })} aria-label="Bearbeiten am" /></td>
                      <td>
                        <select value={s.aufwandMinuten} onChange={(e) => schrittAendern(s._k, { aufwandMinuten: e.target.value })} aria-label="Aufwand">
                          <option value="">–</option>
                          {AUFWAND_MINUTEN.map((m) => <option key={m} value={m}>{formatiereAufwand(m)}</option>)}
                          {s.aufwandMinuten && !AUFWAND_MINUTEN.includes(Number(s.aufwandMinuten)) && <option value={s.aufwandMinuten}>{formatiereAufwand(Number(s.aufwandMinuten))}</option>}
                        </select>
                      </td>
                      <td>
                        <select value={s.verrechnung} onChange={(e) => schrittAendern(s._k, { verrechnung: e.target.value })} aria-label="Verrechnung">
                          {VERRECHNUNG.map((v) => <option key={v.wert} value={v.wert}>{v.label}</option>)}
                        </select>
                      </td>
                      <td className="projekt-schritt-status">{s.id ? s.status : 'neu'}</td>
                      <td><button type="button" className="btn-symbol" onClick={() => schrittEntfernen(s)} title="Teilschritt entfernen">×</button></td>
                    </tr>
                  ))}
                  {geladen && schritte.length === 0 && <tr><td colSpan={6} className="leer-hinweis">Noch keine Teilschritte.</td></tr>}
                </tbody>
              </table>
              <button type="button" className="btn-klein" onClick={schrittHinzufuegen}>+ Teilschritt</button>
            </div>

            <div className="feld">
              <label htmlFor="pr-beschreibung" className="label-mit-diktat">
                Beschreibung
                <DiktatKnopf titel="Beschreibung diktieren" onText={(t) => setKopf((k) => ({ ...k, beschreibung: textAnhaengen(k.beschreibung, t) }))} />
              </label>
              <textarea id="pr-beschreibung" value={kopf.beschreibung} onChange={(e) => feld('beschreibung', e.target.value)} />
            </div>
            {fehler && <div className="hinweis-fehler">{fehler}</div>}
          </div>
          <div className="modal-fuss">
            <div style={{ display: 'flex', gap: 8 }}>
              {pendenz && <button type="button" className="btn btn-gefahr" onClick={loeschen} disabled={speichert}>Löschen</button>}
              {pendenz && <button type="button" className="btn" onClick={() => setDetails(true)} title="Status, Warten auf, Notizen, E-Mail, Zeit">Details…</button>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn" onClick={onSchliessen}>Abbrechen</button>
              <button type="submit" className="btn btn-primary" disabled={speichert}>{speichert ? 'Speichert…' : 'Speichern'}</button>
            </div>
          </div>
        </form>
      </div>
      {details && (
        <div onClick={(e) => e.stopPropagation()}>
          <PendenzDetailModal
            pendenz={pendenz}
            mandanten={mandanten}
            mitarbeitende={mitarbeitende}
            onSchliessen={() => setDetails(false)}
            onGespeichert={() => { setDetails(false); onGespeichert?.(); }}
            onGeloescht={() => { setDetails(false); onGeloescht?.(); }}
          />
        </div>
      )}
    </div>
  );
}
