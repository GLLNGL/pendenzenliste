import { useEffect, useRef, useState } from 'react';
import api from '../api.js';

const RHYTHMUS_LABEL = { monatlich: 'Monatlich', quartalsweise: 'Quartalsweise', halbjaehrlich: 'Halbjährlich', jaehrlich: 'Jährlich' };
const RHYTHMUS_PLATZHALTER = {
  monatlich: '{Monat} {Jahr}',
  quartalsweise: '{Quartal} {Jahr}',
  halbjaehrlich: '{Halbjahr} {Jahr}',
  jaehrlich: '{Jahr}',
};

function configAusRegel(regel) {
  const c = regel?.faelligkeit_config ?? {};
  return {
    tag: c.tag ?? 25,
    tage: c.tage ?? 60,
    monat: c.monat ?? 6,
    jahreOffset: c.jahre_offset ?? 1,
    tageListe: Array.isArray(c.tage) ? c.tage.join(', ') : '15, 28',
  };
}

function baueFaelligkeitConfig(typ, config) {
  switch (typ) {
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

export default function RegelModal({ regel, mandanten, faelligkeitTypen, rhythmen, onSchliessen, onGespeichert, onGeloescht }) {
  const [titelVorlage, setTitelVorlage] = useState(regel?.titel_vorlage ?? '');
  const [mandantId, setMandantId] = useState(regel?.mandant_id ?? '');
  const [rhythmus, setRhythmus] = useState(regel?.rhythmus ?? 'monatlich');
  const [faelligkeitTyp, setFaelligkeitTyp] = useState(regel?.faelligkeit_typ ?? 'tag_des_monats');
  const [config, setConfig] = useState(() => configAusRegel(regel));
  const [vorlaufTage, setVorlaufTage] = useState(regel?.vorlauf_tage ?? 14);
  const [aktiv, setAktiv] = useState(regel?.aktiv ?? 1);
  const [fehler, setFehler] = useState(null);
  const [speichertGerade, setSpeichertGerade] = useState(false);
  const titelRef = useRef(null);

  useEffect(() => { titelRef.current?.focus(); }, []);
  useEffect(() => {
    function onKeyDown(e) { if (e.key === 'Escape') onSchliessen(); }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSchliessen]);

  function configFeld(name, wert) {
    setConfig((c) => ({ ...c, [name]: wert }));
  }

  async function speichern(e) {
    e.preventDefault();
    if (!titelVorlage.trim()) { setFehler('Titel-Vorlage ist erforderlich'); return; }

    const payload = {
      titelVorlage: titelVorlage.trim(),
      mandantId: mandantId === '' ? null : Number(mandantId),
      rhythmus,
      faelligkeitTyp,
      faelligkeitConfig: baueFaelligkeitConfig(faelligkeitTyp, config),
      vorlaufTage: Number(vorlaufTage),
      aktiv: aktiv ? 1 : 0,
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
    if (!window.confirm(`Regel "${regel.titel_vorlage}" wirklich loeschen?`)) return;
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
          <span>{regel ? 'Regel bearbeiten' : 'Neue Wiederkehr-Regel'}</span>
          <button type="button" className="modal-schliessen" onClick={onSchliessen} aria-label="Schliessen">×</button>
        </div>

        <form onSubmit={speichern}>
          <div className="modal-koerper">
            <div className="feld">
              <label htmlFor="regel-titel">Titel-Vorlage *</label>
              <input
                id="regel-titel" ref={titelRef} type="text" value={titelVorlage}
                onChange={(e) => setTitelVorlage(e.target.value)}
                placeholder={`z.B. Lohnlauf ${RHYTHMUS_PLATZHALTER[rhythmus]}`}
                required
              />
            </div>

            <div className="feld-reihe">
              <div className="feld">
                <label htmlFor="regel-mandant">Mandant</label>
                <select id="regel-mandant" value={mandantId} onChange={(e) => setMandantId(e.target.value)}>
                  <option value="">Kein Mandant (intern)</option>
                  {mandanten.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div className="feld">
                <label htmlFor="regel-rhythmus">Rhythmus</label>
                <select id="regel-rhythmus" value={rhythmus} onChange={(e) => setRhythmus(e.target.value)}>
                  {rhythmen.map((r) => <option key={r} value={r}>{RHYTHMUS_LABEL[r] || r}</option>)}
                </select>
              </div>
            </div>

            <div className="feld">
              <label htmlFor="regel-typ">Fälligkeitslogik</label>
              <select id="regel-typ" value={faelligkeitTyp} onChange={(e) => setFaelligkeitTyp(e.target.value)}>
                {faelligkeitTypen.map((t) => <option key={t.typ} value={t.typ}>{t.label}</option>)}
              </select>
            </div>

            {faelligkeitTyp === 'tag_des_monats' && (
              <div className="feld">
                <label htmlFor="cfg-tag">Tag des Monats</label>
                <input id="cfg-tag" type="number" min="1" max="31" value={config.tag} onChange={(e) => configFeld('tag', e.target.value)} />
              </div>
            )}

            {faelligkeitTyp === 'tage_nach_periodenende' && (
              <div className="feld">
                <label htmlFor="cfg-tage">Tage nach Periodenende</label>
                <input id="cfg-tage" type="number" min="0" value={config.tage} onChange={(e) => configFeld('tage', e.target.value)} />
              </div>
            )}

            {faelligkeitTyp === 'tag_monat_folgejahr' && (
              <div className="feld-reihe">
                <div className="feld">
                  <label htmlFor="cfg-tag2">Tag</label>
                  <input id="cfg-tag2" type="number" min="1" max="31" value={config.tag} onChange={(e) => configFeld('tag', e.target.value)} />
                </div>
                <div className="feld">
                  <label htmlFor="cfg-monat">Monat</label>
                  <input id="cfg-monat" type="number" min="1" max="12" value={config.monat} onChange={(e) => configFeld('monat', e.target.value)} />
                </div>
                <div className="feld">
                  <label htmlFor="cfg-jahre">Jahre-Versatz</label>
                  <input id="cfg-jahre" type="number" min="0" max="5" value={config.jahreOffset} onChange={(e) => configFeld('jahreOffset', e.target.value)} />
                </div>
              </div>
            )}

            {faelligkeitTyp === 'tage_des_monats_liste' && (
              <div className="feld">
                <label htmlFor="cfg-liste">Tage im Monat (kommagetrennt)</label>
                <input id="cfg-liste" type="text" value={config.tageListe} onChange={(e) => configFeld('tageListe', e.target.value)} placeholder="15, 28" />
              </div>
            )}

            <div className="feld-reihe">
              <div className="feld">
                <label htmlFor="regel-vorlauf">Vorlaufzeit (Tage)</label>
                <input id="regel-vorlauf" type="number" min="0" value={vorlaufTage} onChange={(e) => setVorlaufTage(e.target.value)} />
              </div>
              <div className="feld">
                <label htmlFor="regel-aktiv">Status</label>
                <select id="regel-aktiv" value={aktiv ? '1' : '0'} onChange={(e) => setAktiv(e.target.value === '1')}>
                  <option value="1">Aktiv</option>
                  <option value="0">Inaktiv</option>
                </select>
              </div>
            </div>

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
