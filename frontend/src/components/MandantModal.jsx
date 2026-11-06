import { useEffect, useRef, useState } from 'react';
import api from '../api.js';
import { meldeMandantenAenderung } from '../events.js';
import { MWST_PERIODEN, ZAHLUNGSLAUF_RHYTHMEN } from '../constants.js';
import { naechsteKundenNr } from '../lib/preise.js';

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// Status im Formular: Aktiv / Potenziell (Interessent, z.B. fuer eine Offerte) / Inaktiv.
function statusVon(mandant) {
  if (mandant && !mandant.aktiv) return 'inaktiv';
  return mandant?.potenziell ? 'potenziell' : 'aktiv';
}

export default function MandantModal({ mandant, alleMandanten = [], vorgabeStatus = 'aktiv', vorgabeName = '', onSchliessen, onGespeichert }) {
  const [formular, setFormular] = useState(() => ({
    name: mandant?.name ?? vorgabeName,
    kuerzel: mandant?.kuerzel ?? '',
    email: mandant?.email ?? '',
    geschaeftsfuehrungEmail: mandant?.geschaeftsfuehrung_email ?? '',
    status: mandant ? statusVon(mandant) : vorgabeStatus,
    kundenNr: mandant?.kunden_nr ?? (mandant ? '' : naechsteKundenNr(alleMandanten)),
    ansprechperson: mandant?.ansprechperson ?? '',
    strasse: mandant?.strasse ?? '',
    plz: mandant?.plz ?? '',
    ort: mandant?.ort ?? '',
    telefon: mandant?.telefon ?? '',
    ablagePfad: mandant?.ablage_pfad ?? '',
    ablageLink: mandant?.ablage_link ?? '',
    notizen: mandant?.notizen ?? '',
    // Mandats-Eckdaten -- Grundlage fuer die wiederkehrenden Pendenzen (Vorlauf je Mandant).
    mwstPeriode: mandant?.mwst_periode ?? '',
    lohnzahltag: mandant?.lohnzahltag ?? '',
    zahlungslaufRhythmus: mandant?.zahlungslauf_rhythmus ?? '',
    abschlussWunschTag: mandant?.abschluss_wunsch_tag ?? '',
    abschlussWunschMonat: mandant?.abschluss_wunsch_monat ?? '',
  }));
  const [fehler, setFehler] = useState(null);
  const [speichertGerade, setSpeichertGerade] = useState(false);
  const nameRef = useRef(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onSchliessen();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSchliessen]);

  function feldAendern(name, wert) {
    setFormular((f) => ({ ...f, [name]: wert }));
  }

  async function speichern(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!formular.name.trim()) { setFehler('Name ist erforderlich'); return; }
    if ((formular.abschlussWunschTag === '') !== (formular.abschlussWunschMonat === '')) {
      setFehler('Abschluss-Wunschtermin: bitte Tag und Monat angeben (oder beides leer lassen).');
      return;
    }
    setSpeichertGerade(true);
    setFehler(null);
    try {
      const payload = {
        name: formular.name.trim(),
        kuerzel: formular.kuerzel.trim() || null,
        email: formular.email.trim() || null,
        geschaeftsfuehrungEmail: formular.geschaeftsfuehrungEmail.trim() || null,
        aktiv: formular.status !== 'inaktiv',
        potenziell: formular.status === 'potenziell',
        kundenNr: formular.kundenNr,
        ansprechperson: formular.ansprechperson,
        strasse: formular.strasse,
        plz: formular.plz,
        ort: formular.ort,
        telefon: formular.telefon,
        ablagePfad: formular.ablagePfad,
        ablageLink: formular.ablageLink,
        notizen: formular.notizen.trim() || null,
        mwstPeriode: formular.mwstPeriode || null,
        lohnzahltag: formular.lohnzahltag,
        zahlungslaufRhythmus: formular.zahlungslaufRhythmus || null,
        abschlussWunschTag: formular.abschlussWunschTag,
        abschlussWunschMonat: formular.abschlussWunschMonat,
      };
      const ergebnis = mandant
        ? await api.mandanten.aktualisieren(mandant.id, payload)
        : await api.mandanten.erstellen(payload);
      meldeMandantenAenderung();
      onGespeichert(ergebnis);
    } catch (err) {
      setFehler(err.message);
      setSpeichertGerade(false);
    }
  }

  return (
    <div className="modal-hintergrund" onClick={onSchliessen}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-kopf">
          <span>{mandant ? 'Mandant bearbeiten' : 'Neuer Mandant'}</span>
          <button type="button" className="modal-schliessen" onClick={onSchliessen} aria-label="Schliessen">×</button>
        </div>

        <form onSubmit={speichern}>
          <div className="modal-koerper">
            <div className="feld">
              <label htmlFor="mandant-name">Name *</label>
              <input id="mandant-name" ref={nameRef} type="text" value={formular.name} onChange={(e) => feldAendern('name', e.target.value)} required />
            </div>
            <div className="feld-reihe">
              <div className="feld">
                <label htmlFor="mandant-kuerzel">Kürzel</label>
                <input id="mandant-kuerzel" type="text" value={formular.kuerzel} onChange={(e) => feldAendern('kuerzel', e.target.value)} maxLength={10} />
              </div>
              <div className="feld">
                <label htmlFor="mandant-status">Status</label>
                <select id="mandant-status" value={formular.status} onChange={(e) => feldAendern('status', e.target.value)}>
                  <option value="aktiv">Aktiv</option>
                  <option value="potenziell">Potenziell (Interessent)</option>
                  <option value="inaktiv">Inaktiv</option>
                </select>
              </div>
            </div>
            <div className="feld-reihe">
              <div className="feld">
                <label htmlFor="mandant-kunden-nr">Kunden-Nr.</label>
                <input id="mandant-kunden-nr" type="text" value={formular.kundenNr} onChange={(e) => feldAendern('kundenNr', e.target.value)} placeholder={naechsteKundenNr(alleMandanten)} maxLength={20} />
              </div>
              <div className="feld">
                <label htmlFor="mandant-ansprechperson">Ansprechperson</label>
                <input id="mandant-ansprechperson" type="text" value={formular.ansprechperson} onChange={(e) => feldAendern('ansprechperson', e.target.value)} />
              </div>
            </div>
            <div className="feld">
              <label htmlFor="mandant-strasse">Strasse</label>
              <input id="mandant-strasse" type="text" value={formular.strasse} onChange={(e) => feldAendern('strasse', e.target.value)} />
            </div>
            <div className="feld-reihe feld-reihe-plz">
              <div className="feld">
                <label htmlFor="mandant-plz">PLZ</label>
                <input id="mandant-plz" type="text" value={formular.plz} onChange={(e) => feldAendern('plz', e.target.value)} maxLength={10} />
              </div>
              <div className="feld">
                <label htmlFor="mandant-ort">Ort</label>
                <input id="mandant-ort" type="text" value={formular.ort} onChange={(e) => feldAendern('ort', e.target.value)} />
              </div>
            </div>
            <div className="feld">
              <label htmlFor="mandant-telefon">Telefon</label>
              <input id="mandant-telefon" type="tel" value={formular.telefon} onChange={(e) => feldAendern('telefon', e.target.value)} />
            </div>

            <div className="feld-gruppe-titel">Ablage</div>
            <div className="feld">
              <label htmlFor="mandant-ablage-pfad">Ordner im Windows Explorer</label>
              <input
                id="mandant-ablage-pfad"
                type="text"
                value={formular.ablagePfad}
                onChange={(e) => feldAendern('ablagePfad', e.target.value.replace(/^"|"$/g, ''))}
                placeholder="C:Users…OneDrive - EST Controlling GmbHEST – Mandantenablage - …Mandant"
              />
              <p className="feld-hinweis">Im Explorer den Ordner öffnen, oben in die Adresszeile klicken, Pfad kopieren (Ctrl+C) und hier einfügen.</p>
            </div>
            <div className="feld">
              <label htmlFor="mandant-ablage-link">Link auf den Ordner (SharePoint / OneDrive)</label>
              <input
                id="mandant-ablage-link"
                type="url"
                value={formular.ablageLink}
                onChange={(e) => feldAendern('ablageLink', e.target.value)}
                placeholder="https://estcontrollinggmbh.sharepoint.com/sites/ESTMandantenablage/…"
              />
              <p className="feld-hinweis">Im Explorer Rechtsklick auf den Ordner → «Link kopieren» bzw. «Online anzeigen» und die Adresse kopieren. Öffnet die Ablage mit einem Klick; Dokumente lassen sich dort per Drag &amp; Drop ablegen.</p>
            </div>
            <div className="feld">
              <label htmlFor="mandant-email">Ansprechpartner/in E-Mail</label>
              <input id="mandant-email" type="email" value={formular.email} onChange={(e) => feldAendern('email', e.target.value)} placeholder="kontakt@mandant.ch" />
              <p className="feld-hinweis">Für die laufende Kommunikation – wird beim E-Mail-Versand automatisch vorausgefüllt.</p>
            </div>
            <div className="feld">
              <label htmlFor="mandant-email-gf">E-Mail Geschäftsführung / Inhaber</label>
              <input
                id="mandant-email-gf"
                type="email"
                value={formular.geschaeftsfuehrungEmail}
                onChange={(e) => feldAendern('geschaeftsfuehrungEmail', e.target.value)}
                placeholder="inhaber@mandant.ch"
              />
              <p className="feld-hinweis">Optional, nur für grundsätzliche Fragen – muss beim Versand manuell ausgewählt werden.</p>
            </div>

            <div className="feld-gruppe-titel">Mandats-Eckdaten</div>
            <div className="feld-reihe">
              <div className="feld">
                <label htmlFor="mandant-mwst">MWST-Periode</label>
                <select id="mandant-mwst" value={formular.mwstPeriode} onChange={(e) => feldAendern('mwstPeriode', e.target.value)}>
                  <option value="">– nicht erfasst –</option>
                  {MWST_PERIODEN.map((p) => <option key={p} value={p}>{p === 'keine' ? 'Keine (nicht MWST-pflichtig)' : p}</option>)}
                </select>
              </div>
              <div className="feld">
                <label htmlFor="mandant-lohnzahltag">Lohnzahltag (Tag im Monat)</label>
                <input
                  id="mandant-lohnzahltag"
                  type="number"
                  min="1"
                  max="31"
                  value={formular.lohnzahltag}
                  onChange={(e) => feldAendern('lohnzahltag', e.target.value)}
                  placeholder="z.B. 25"
                />
              </div>
            </div>
            <div className="feld-reihe">
              <div className="feld">
                <label htmlFor="mandant-zahlungslauf">Rhythmus Zahlungslauf</label>
                <select id="mandant-zahlungslauf" value={formular.zahlungslaufRhythmus} onChange={(e) => feldAendern('zahlungslaufRhythmus', e.target.value)}>
                  <option value="">– nicht erfasst –</option>
                  {ZAHLUNGSLAUF_RHYTHMEN.map((r) => <option key={r.wert} value={r.wert}>{r.label}</option>)}
                </select>
              </div>
              <div className="feld">
                <label htmlFor="mandant-abschluss-tag">Abschluss-Wunschtermin</label>
                <div className="feld-inline">
                  <input
                    id="mandant-abschluss-tag"
                    type="number"
                    min="1"
                    max="31"
                    value={formular.abschlussWunschTag}
                    onChange={(e) => feldAendern('abschlussWunschTag', e.target.value)}
                    placeholder="Tag"
                    aria-label="Abschluss-Wunschtermin Tag"
                  />
                  <select
                    value={formular.abschlussWunschMonat}
                    onChange={(e) => feldAendern('abschlussWunschMonat', e.target.value)}
                    aria-label="Abschluss-Wunschtermin Monat"
                  >
                    <option value="">Monat</option>
                    {MONATE.map((m, idx) => <option key={m} value={idx + 1}>{m}</option>)}
                  </select>
                </div>
                <p className="feld-hinweis">Jährlich wiederkehrend, z.B. 30. Juni.</p>
              </div>
            </div>

            <div className="feld">
              <label htmlFor="mandant-notizen">Notizen</label>
              <textarea id="mandant-notizen" value={formular.notizen} onChange={(e) => feldAendern('notizen', e.target.value)} />
            </div>
            {fehler && <div className="hinweis-fehler">{fehler}</div>}
          </div>
          <div className="modal-fuss">
            <div />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn" onClick={onSchliessen}>Abbrechen</button>
              <button type="submit" className="btn btn-primary" disabled={speichertGerade}>Speichern</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
