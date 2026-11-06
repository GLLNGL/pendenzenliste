import { useLeistungen } from '../hooks.js';
import { useEffect, useRef, useState } from 'react';
import api from '../api.js';
import { BLOECKE, PRIORITAETEN, PRIORITAET_BESCHREIBUNG, AUFWAND_MINUTEN, RHYTHMUS_LABEL, formatiereAufwand } from '../constants.js';
import { REGEL_TYPEN, vorlageFuerTyp } from '../lib/regelVorlagen.js';
import { istWochenRhythmus, naechstePendenzen, heutigesDatumUTC } from '../lib/recurrence.js';
import { formatiereDatum } from '../format.js';

const WOCHENTAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];
const PLATZHALTER_HINWEIS = 'Platzhalter: {Datum}, {Monat}, {Quartal}, {Halbjahr}, {Jahr}';

function configAusRegel(regel) {
  const c = regel?.faelligkeit_config ?? {};
  return {
    tag: c.tag ?? 25,
    tage: c.tage ?? 60,
    monat: c.monat ?? 6,
    jahreOffset: c.jahre_offset ?? 1,
    tageListe: Array.isArray(c.tage) ? c.tage.join(', ') : '15, 28',
    wochentag: c.wochentag ?? 5,
    anker: c.anker ?? '',
  };
}

function baueFaelligkeitConfig(typ, config) {
  switch (typ) {
    case 'wochentag':
      return config.anker ? { wochentag: Number(config.wochentag), anker: config.anker } : { wochentag: Number(config.wochentag) };
    case 'tag_des_monats':
      return { tag: Number(config.tag) };
    case 'letzter_tag_des_monats':
      return {};
    case 'tage_nach_periodenende':
      return { tage: Number(config.tage) };
    case 'tag_monat_folgejahr':
      return { tag: Number(config.tag), monat: Number(config.monat), jahre_offset: Number(config.jahreOffset) };
    case 'tage_des_monats_liste':
      return { tage: config.tageListe.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)) };
    default:
      return {};
  }
}

// Formularzustand aus einer bestehenden Regel bzw. aus der Vorlage eines Typs.
function formularAusRegel(regel) {
  return {
    typ: regel.typ || 'Sonstiges',
    titelVorlage: regel.titel_vorlage ?? '',
    mandantId: regel.mandant_id ?? '',
    rhythmus: regel.rhythmus ?? 'monatlich',
    faelligkeitTyp: regel.faelligkeit_typ ?? 'tag_des_monats',
    config: configAusRegel(regel),
    vorlaufTage: regel.vorlauf_tage ?? 7,
    vorlaufEinheit: regel.vorlauf_einheit || 'tage',
    block: regel.block || 'Sonstiges',
    prioritaet: regel.prioritaet || 'B',
    harteFrist: !!regel.harte_frist,
    aufwandMinuten: regel.aufwand_minuten ?? '',
    leistungId: regel.leistung_id == null ? '' : String(regel.leistung_id),
    checkliste: (regel.checkliste || []).join('\n'),
    aktiv: regel.aktiv ?? true,
  };
}

function formularAusVorlage(typ, mandantId, mandant, bisher) {
  const v = vorlageFuerTyp(typ, mandant);
  return {
    ...bisher,
    typ,
    mandantId,
    titelVorlage: v.titelVorlage || bisher.titelVorlage,
    rhythmus: v.rhythmus,
    faelligkeitTyp: v.faelligkeitTyp,
    config: { ...bisher.config, ...configAusRegel({ faelligkeit_config: v.faelligkeitConfig }) },
    vorlaufTage: v.vorlaufTage,
    vorlaufEinheit: v.vorlaufEinheit,
    block: v.block,
    prioritaet: v.prioritaet,
    harteFrist: v.harteFrist,
    checkliste: v.checkliste.join('\n'),
  };
}

export default function RegelModal({ regel, mandanten, faelligkeitTypen, rhythmen, onSchliessen, onGespeichert, onGeloescht }) {
  const leistungen = useLeistungen();
  const [f, setF] = useState(() => (regel
    ? formularAusRegel(regel)
    : formularAusVorlage('Lohnlauf', '', null, formularAusRegel({}))));
  // Bei einer NEUEN Regel uebernimmt ein Wechsel von Typ/Mandant automatisch die Standardwerte;
  // bei einer bestehenden nur auf Knopfdruck, damit nichts ungefragt ueberschrieben wird.
  const [automatisch, setAutomatisch] = useState(!regel);
  const [fehler, setFehler] = useState(null);
  const [speichertGerade, setSpeichertGerade] = useState(false);
  const titelRef = useRef(null);

  useEffect(() => { titelRef.current?.focus(); }, []);
  useEffect(() => {
    function onKeyDown(e) { if (e.key === 'Escape') onSchliessen(); }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSchliessen]);

  const mandantVon = (id) => mandanten.find((m) => m.id === Number(id)) || null;

  function feld(name, wert) {
    setF((alt) => ({ ...alt, [name]: wert }));
  }

  function configFeld(name, wert) {
    setF((alt) => ({ ...alt, config: { ...alt.config, [name]: wert } }));
  }

  function typWaehlen(typ) {
    if (automatisch) setF((alt) => formularAusVorlage(typ, alt.mandantId, mandantVon(alt.mandantId), alt));
    else feld('typ', typ);
  }

  function mandantWaehlen(id) {
    if (automatisch) setF((alt) => formularAusVorlage(alt.typ, id, mandantVon(id), alt));
    else feld('mandantId', id);
  }

  function vorlageUebernehmen() {
    setF((alt) => formularAusVorlage(alt.typ, alt.mandantId, mandantVon(alt.mandantId), alt));
    setAutomatisch(true);
  }

  // Woche/14 Tage passen nur zur Faelligkeit "Wochentag" und umgekehrt.
  function rhythmusWaehlen(rhythmus) {
    setF((alt) => {
      const woche = istWochenRhythmus(rhythmus);
      let faelligkeitTyp = alt.faelligkeitTyp;
      if (woche) faelligkeitTyp = 'wochentag';
      else if (faelligkeitTyp === 'wochentag') faelligkeitTyp = 'tag_des_monats';
      return { ...alt, rhythmus, faelligkeitTyp };
    });
  }

  const passendeTypen = faelligkeitTypen.filter((t) => (istWochenRhythmus(f.rhythmus) ? t.typ === 'wochentag' : t.typ !== 'wochentag'));
  const checkliste = f.checkliste.split('\n').map((s) => s.trim()).filter(Boolean);

  let vorschau = [];
  try {
    vorschau = naechstePendenzen({
      titel_vorlage: f.titelVorlage || '(ohne Titel)',
      rhythmus: f.rhythmus,
      faelligkeit_typ: f.faelligkeitTyp,
      faelligkeit_config: baueFaelligkeitConfig(f.faelligkeitTyp, f.config),
      vorlauf_tage: Number(f.vorlaufTage) || 0,
      vorlauf_einheit: f.vorlaufEinheit,
    }, heutigesDatumUTC(), 3);
  } catch {
    vorschau = []; // unvollstaendige Eingabe -- Vorschau einfach weglassen
  }

  async function speichern(e) {
    e.preventDefault();
    if (!f.titelVorlage.trim()) { setFehler('Titel-Vorlage ist erforderlich'); return; }

    const payload = {
      typ: f.typ,
      titelVorlage: f.titelVorlage.trim(),
      mandantId: f.mandantId === '' ? null : Number(f.mandantId),
      rhythmus: f.rhythmus,
      faelligkeitTyp: f.faelligkeitTyp,
      faelligkeitConfig: baueFaelligkeitConfig(f.faelligkeitTyp, f.config),
      vorlaufTage: Number(f.vorlaufTage),
      vorlaufEinheit: f.vorlaufEinheit,
      block: f.block,
      prioritaet: f.prioritaet,
      harteFrist: f.harteFrist,
      aufwandMinuten: f.aufwandMinuten,
      leistungId: f.leistungId === '' || f.leistungId == null ? null : Number(f.leistungId),
      checkliste,
      aktiv: f.aktiv ? 1 : 0,
    };

    setSpeichertGerade(true);
    setFehler(null);
    try {
      const ergebnis = regel
        ? await api.regeln.aktualisieren(regel.id, payload)
        : await api.regeln.erstellen(payload);
      onGespeichert(ergebnis);
    } catch (err) {
      setFehler(err.message);
      setSpeichertGerade(false);
    }
  }

  async function loeschen() {
    if (!regel) return;
    if (!window.confirm(`Regel "${regel.titel_vorlage}" wirklich löschen? Bereits erzeugte Pendenzen bleiben bestehen.`)) return;
    setSpeichertGerade(true);
    try {
      await api.regeln.loeschen(regel.id);
      onGeloescht(regel);
    } catch (err) {
      setFehler(err.message);
      setSpeichertGerade(false);
    }
  }

  return (
    <div className="modal-hintergrund" onClick={onSchliessen}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-kopf">
          <span>{regel ? 'Wiederkehrende Arbeit bearbeiten' : 'Neue wiederkehrende Arbeit'}</span>
          <button type="button" className="modal-schliessen" onClick={onSchliessen} aria-label="Schliessen">×</button>
        </div>

        <form onSubmit={speichern} noValidate>
          <div className="modal-koerper">
            <div className="feld-reihe">
              <div className="feld">
                <label htmlFor="regel-arbeitstyp">Typ</label>
                <select id="regel-arbeitstyp" value={f.typ} onChange={(e) => typWaehlen(e.target.value)}>
                  {REGEL_TYPEN.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="feld">
                <label htmlFor="regel-mandant">Mandant</label>
                <select id="regel-mandant" value={f.mandantId} onChange={(e) => mandantWaehlen(e.target.value)}>
                  <option value="">Intern (eigenes Büro)</option>
                  {mandanten.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            </div>
            {automatisch ? (
              <p className="feld-hinweis">Standardwerte aus Typ und Mandats-Eckdaten übernommen – alles bleibt änderbar.</p>
            ) : (
              <button type="button" className="btn-klein" style={{ width: 'fit-content' }} onClick={vorlageUebernehmen}>
                Standardwerte für «{f.typ}» übernehmen
              </button>
            )}

            <div className="feld">
              <label htmlFor="regel-titel">Titel-Vorlage (nächster Schritt) *</label>
              <input
                id="regel-titel" ref={titelRef} type="text" value={f.titelVorlage}
                onChange={(e) => feld('titelVorlage', e.target.value)}
                placeholder="z.B. Lohnlauf {Monat} {Jahr} durchführen"
              />
              <p className="feld-hinweis">{PLATZHALTER_HINWEIS}</p>
            </div>

            <div className="feld-reihe">
              <div className="feld">
                <label htmlFor="regel-rhythmus">Rhythmus</label>
                <select id="regel-rhythmus" value={f.rhythmus} onChange={(e) => rhythmusWaehlen(e.target.value)}>
                  {rhythmen.map((r) => <option key={r} value={r}>{RHYTHMUS_LABEL[r] || r}</option>)}
                </select>
              </div>
              <div className="feld">
                <label htmlFor="regel-typ">Fälligkeit</label>
                <select id="regel-typ" value={f.faelligkeitTyp} onChange={(e) => feld('faelligkeitTyp', e.target.value)}>
                  {passendeTypen.map((t) => <option key={t.typ} value={t.typ}>{t.label}</option>)}
                </select>
              </div>
            </div>

            {f.faelligkeitTyp === 'wochentag' && (
              <div className="feld-reihe">
                <div className="feld">
                  <label htmlFor="cfg-wochentag">Wochentag</label>
                  <select id="cfg-wochentag" value={f.config.wochentag} onChange={(e) => configFeld('wochentag', e.target.value)}>
                    {WOCHENTAGE.map((w, idx) => <option key={w} value={idx + 1}>{w}</option>)}
                  </select>
                </div>
                {f.rhythmus === '14-taeglich' && (
                  <div className="feld">
                    <label htmlFor="cfg-anker">Erste Woche (beliebiger Tag darin)</label>
                    <input id="cfg-anker" type="date" value={f.config.anker} onChange={(e) => configFeld('anker', e.target.value)} />
                  </div>
                )}
              </div>
            )}

            {f.faelligkeitTyp === 'tag_des_monats' && (
              <div className="feld">
                <label htmlFor="cfg-tag">Tag des Monats</label>
                <input id="cfg-tag" type="number" min="1" max="31" value={f.config.tag} onChange={(e) => configFeld('tag', e.target.value)} />
              </div>
            )}

            {f.faelligkeitTyp === 'tage_nach_periodenende' && (
              <div className="feld">
                <label htmlFor="cfg-tage">Tage nach Periodenende (z.B. MWST-Einreichefrist 60)</label>
                <input id="cfg-tage" type="number" min="0" value={f.config.tage} onChange={(e) => configFeld('tage', e.target.value)} />
              </div>
            )}

            {f.faelligkeitTyp === 'tag_monat_folgejahr' && (
              <div className="feld-reihe">
                <div className="feld">
                  <label htmlFor="cfg-tag2">Tag</label>
                  <input id="cfg-tag2" type="number" min="1" max="31" value={f.config.tag} onChange={(e) => configFeld('tag', e.target.value)} />
                </div>
                <div className="feld">
                  <label htmlFor="cfg-monat">Monat</label>
                  <input id="cfg-monat" type="number" min="1" max="12" value={f.config.monat} onChange={(e) => configFeld('monat', e.target.value)} />
                </div>
                <div className="feld">
                  <label htmlFor="cfg-jahre">Jahre-Versatz</label>
                  <input id="cfg-jahre" type="number" min="0" max="5" value={f.config.jahreOffset} onChange={(e) => configFeld('jahreOffset', e.target.value)} />
                </div>
              </div>
            )}

            {f.faelligkeitTyp === 'tage_des_monats_liste' && (
              <div className="feld">
                <label htmlFor="cfg-liste">Tage im Monat (kommagetrennt)</label>
                <input id="cfg-liste" type="text" value={f.config.tageListe} onChange={(e) => configFeld('tageListe', e.target.value)} placeholder="15, 28" />
              </div>
            )}

            <div className="feld-reihe">
              <div className="feld">
                <label htmlFor="regel-vorlauf">Vorlauf</label>
                <div className="feld-inline">
                  <input id="regel-vorlauf" type="number" min="0" value={f.vorlaufTage} onChange={(e) => feld('vorlaufTage', e.target.value)} />
                  <select value={f.vorlaufEinheit} onChange={(e) => feld('vorlaufEinheit', e.target.value)} aria-label="Einheit Vorlauf">
                    <option value="tage">Tage vorher</option>
                    <option value="arbeitstage">Arbeitstage vorher</option>
                  </select>
                </div>
              </div>
              <div className="feld">
                <label htmlFor="regel-block">Block</label>
                <select id="regel-block" value={f.block} onChange={(e) => feld('block', e.target.value)}>
                  {BLOECKE.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            </div>

            <div className="feld-reihe">
              <div className="feld">
                <label htmlFor="regel-prio">Priorität</label>
                <select id="regel-prio" value={f.prioritaet} onChange={(e) => feld('prioritaet', e.target.value)}>
                  {PRIORITAETEN.map((p) => <option key={p} value={p}>{PRIORITAET_BESCHREIBUNG[p]}</option>)}
                </select>
                <label className="feld-checkbox">
                  <input type="checkbox" checked={f.harteFrist} onChange={(e) => feld('harteFrist', e.target.checked)} />
                  Harte Frist (Behörde/Zahlung)
                </label>
              </div>
              <div className="feld">
                <label htmlFor="regel-aufwand">Aufwand{checkliste.length ? ' (bei Checkliste je Schritt)' : ''}</label>
                <select id="regel-aufwand" value={f.aufwandMinuten} onChange={(e) => feld('aufwandMinuten', e.target.value)} disabled={checkliste.length > 0}>
                  <option value="">– nicht geschätzt –</option>
                  {AUFWAND_MINUTEN.map((m) => <option key={m} value={m}>{formatiereAufwand(m)}</option>)}
                </select>
              </div>
            </div>

            <div className="feld">
              <label htmlFor="regel-leistung">Leistung (Zeiterfassung)</label>
              <select id="regel-leistung" value={f.leistungId ?? ''} onChange={(e) => feld('leistungId', e.target.value)}>
                <option value="">– keine –</option>
                {leistungen.filter((l) => l.aktiv || String(l.id) === String(f.leistungId ?? '')).map((l) => <option key={l.id} value={String(l.id)}>{l.name}</option>)}
              </select>
              <p className="feld-hinweis">Wird beim Erfassen der Zeit vorgeschlagen – daraus ergibt sich, ob die Arbeit in der Pauschale ist.</p>
            </div>

            <div className="feld">
              <label htmlFor="regel-checkliste">Checkliste (ein Schritt pro Zeile)</label>
              <textarea id="regel-checkliste" rows={5} value={f.checkliste} onChange={(e) => feld('checkliste', e.target.value)} placeholder="Leer lassen für eine einzelne Pendenz" />
              <p className="feld-hinweis">
                {checkliste.length
                  ? `Wird als Projekt mit ${checkliste.length} Schritten angelegt – nur der erste ist aktiv, die weiteren rücken nach.`
                  : 'Ohne Checkliste entsteht eine einzelne Pendenz.'}
              </p>
            </div>

            <div className="feld">
              <label htmlFor="regel-aktiv">Status</label>
              <select id="regel-aktiv" value={f.aktiv ? '1' : '0'} onChange={(e) => feld('aktiv', e.target.value === '1')}>
                <option value="1">Aktiv</option>
                <option value="0">Inaktiv</option>
              </select>
            </div>

            {vorschau.length > 0 && (
              <div className="feld">
                <label>Vorschau – die nächsten 3</label>
                <ul className="vorschau-liste">
                  {vorschau.map((v) => (
                    <li key={v.periodenSchluessel}>
                      {v.titel} – fällig {formatiereDatum(v.faelligkeit)}, erscheint {formatiereDatum(v.erscheintAb)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {fehler && <div className="hinweis-fehler">{fehler}</div>}
          </div>

          <div className="modal-fuss">
            <div>
              {regel && <button type="button" className="btn btn-gefahr" onClick={loeschen} disabled={speichertGerade}>Löschen</button>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn" onClick={onSchliessen}>Abbrechen</button>
              <button type="submit" className="btn btn-primary" disabled={speichertGerade}>{regel ? 'Speichern' : 'Erstellen'}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
