import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api.js';
import PendenzModal from '../components/PendenzModal.jsx';
import MandantModal from '../components/MandantModal.jsx';
import PauschalenModal from '../components/PauschalenModal.jsx';
import AblageKnoepfe from '../components/AblageKnoepfe.jsx';
import DateienListe from '../components/DateienListe.jsx';
import OnboardingBereich from '../components/OnboardingBereich.jsx';
import { aktivePauschalen, pauschalenSumme, formatiereCHF } from '../lib/preise.js';
import { OFFERT_STATUS, betragMonat, chf } from '../lib/offerte.js';
import { ablageVon, relativerOrdner } from '../lib/ablage.js';
import { unterstuetzt, ordnerAnlegen } from '../lib/ablageOrdner.js';
import { phaseVon, PHASEN } from '../lib/onboarding.js';
import { useAblageGrund, useMandanten, useMitarbeitende } from '../hooks.js';
import { aufAenderungHoeren, aufMandantenAenderungHoeren } from '../events.js';
import { ZAHLUNGSLAUF_RHYTHMEN, formatiereAufwand } from '../constants.js';
import { formatiereDatum, heutigesDatumISO } from '../format.js';

const AUSWAHL_SCHLUESSEL = 'mandanten-auswahl';
const FILTER_SCHLUESSEL = 'mandanten-filter';
const MONATE = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'];
const REITER = [
  { key: 'stamm', label: 'Stammdaten & Ablage' },
  { key: 'offerten', label: 'Offerten' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'erledigt', label: 'Erledigte Aufträge' },
];
const FILTER = [
  { wert: 'aktiv', label: 'Aktive' },
  { wert: 'potenziell', label: 'Interessenten' },
  { wert: 'inaktiv', label: 'Inaktive' },
  { wert: 'alle', label: 'Alle' },
];

function lesen(schluessel, standard) {
  try { return localStorage.getItem(schluessel) || standard; } catch { return standard; }
}
function merken(schluessel, wert) {
  try { localStorage.setItem(schluessel, wert); } catch { /* ohne Speicher weiter */ }
}

function passtFilter(m, filter) {
  if (filter === 'alle') return true;
  if (filter === 'inaktiv') return !m.aktiv;
  if (filter === 'potenziell') return m.aktiv && m.potenziell;
  return m.aktiv && !m.potenziell;
}

function eckdaten(m) {
  const teile = [];
  if (m.mwst_periode) teile.push(m.mwst_periode === 'keine' ? 'keine MWST' : `MWST ${m.mwst_periode}`);
  if (m.lohnzahltag) teile.push(`Lohnzahltag ${m.lohnzahltag}.`);
  const zahlung = ZAHLUNGSLAUF_RHYTHMEN.find((r) => r.wert === m.zahlungslauf_rhythmus);
  if (zahlung) teile.push(`Zahlungslauf ${zahlung.label}`);
  if (m.abschluss_wunsch_tag && m.abschluss_wunsch_monat) teile.push(`Abschluss bis ${m.abschluss_wunsch_tag}. ${MONATE[m.abschluss_wunsch_monat - 1]}`);
  return teile;
}

// Modul Kundenstamm › Mandanten: links die Mandanten (Aktive / Interessenten / Inaktive), rechts
// der gewaehlte Mandant im Ablauf Interessent -> Offerte -> Onboarding -> Mandat. Keine offenen
// Pendenzen hier (die gehoeren ins Cockpit), nur die erledigten Auftraege.
export default function Mandanten() {
  const [params, setParams] = useSearchParams();
  const [liste, setListe] = useState([]);
  const [offerten, setOfferten] = useState([]);
  const [pauschalen, setPauschalen] = useState([]);
  const [onboardings, setOnboardings] = useState({});
  const [erledigte, setErledigte] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [filter, setFilter] = useState(() => lesen(FILTER_SCHLUESSEL, 'aktiv'));
  const [suche, setSuche] = useState('');
  const [dialog, setDialog] = useState(null); // 'neu' | 'bearbeiten' | 'pauschalen'
  const [offenePendenz, setOffenePendenz] = useState(null);
  const [ordnerMeldung, setOrdnerMeldung] = useState(null);
  const navigate = useNavigate();
  const grund = useAblageGrund();
  const mandantenFuerModal = useMandanten();
  const mitarbeitende = useMitarbeitende();

  const auswahlId = params.get('mandant') || lesen(AUSWAHL_SCHLUESSEL, '');
  const reiter = REITER.some((r) => r.key === params.get('reiter')) ? params.get('reiter') : 'stamm';

  const laden = useCallback(() => {
    api.mandanten.liste().then((m) => { setListe(m); setFehler(null); }).catch((e) => setFehler(e.message));
    api.offerten.liste().then(setOfferten).catch(() => setOfferten([]));
    api.pauschalen.liste().then(setPauschalen).catch(() => setPauschalen([]));
  }, []);
  useEffect(() => {
    laden();
    return aufMandantenAenderungHoeren(laden);
  }, [laden]);

  const gewaehlt = liste.find((m) => String(m.id) === String(auswahlId)) || null;
  const gewaehltId = gewaehlt?.id ?? null;

  // Onboarding und erledigte Auftraege des gewaehlten Mandanten.
  const ladenMandant = useCallback(() => {
    if (!gewaehltId) return;
    api.onboarding.holen(gewaehltId).then((o) => setOnboardings((alt) => ({ ...alt, [gewaehltId]: o }))).catch(() => {});
    api.pendenzen.erledigteVon(gewaehltId).then(setErledigte).catch(() => setErledigte([]));
  }, [gewaehltId]);
  useEffect(() => {
    const zeitgeber = setTimeout(ladenMandant, 0);
    const weg = aufAenderungHoeren(ladenMandant);
    return () => { clearTimeout(zeitgeber); weg(); };
  }, [ladenMandant]);

  function waehlen(id, neuerReiter = reiter) {
    merken(AUSWAHL_SCHLUESSEL, String(id));
    setErledigte(null);
    setOrdnerMeldung(null);
    setParams({ mandant: String(id), reiter: neuerReiter }, { replace: true });
  }
  function reiterWaehlen(key) {
    setParams({ mandant: String(gewaehltId ?? ''), reiter: key }, { replace: true });
  }
  function filterWaehlen(wert) {
    setFilter(wert);
    merken(FILTER_SCHLUESSEL, wert);
  }

  if (fehler) return <div className="fehleranzeige">Fehler beim Laden: {fehler}</div>;

  const t = suche.trim().toLowerCase();
  const sichtbar = liste.filter((m) => (t ? `${m.name} ${m.kunden_nr ?? ''} ${m.kuerzel ?? ''}`.toLowerCase().includes(t) : passtFilter(m, filter)));
  const offertenVon = gewaehlt ? offerten.filter((o) => o.mandant_id === gewaehlt.id) : [];
  const onboarding = gewaehlt ? onboardings[gewaehlt.id] ?? null : null;
  const phase = gewaehlt ? phaseVon(gewaehlt, offertenVon, onboarding) : 0;
  const heute = heutigesDatumISO();
  const pauschaleMonat = gewaehlt ? pauschalenSumme(aktivePauschalen(pauschalen.filter((p) => p.mandant_id === gewaehlt.id), heute)) : 0;
  const ablage = ablageVon(gewaehlt, grund);
  const ordner = relativerOrdner(gewaehlt, grund);

  async function ordnerAnlegenKlick() {
    setOrdnerMeldung(null);
    try {
      setOrdnerMeldung(`Ordner bereit: ${await ordnerAnlegen(ordner)}`);
    } catch (err) {
      if (err?.name !== 'AbortError') setOrdnerMeldung(`Fehler: ${err.message}`);
    }
  }

  const spalte = (
    <div className="mandanten-liste">
      <input type="search" className="mandanten-suche" placeholder="Mandant suchen" value={suche} onChange={(e) => setSuche(e.target.value)} />
      {!t && (
        <div className="mandanten-filter" role="tablist">
          {FILTER.map((f) => (
            <button key={f.wert} type="button" className={`mandanten-filter-knopf ${filter === f.wert ? 'aktiv' : ''}`} onClick={() => filterWaehlen(f.wert)}>
              {f.label} <span className="mandanten-filter-zahl">{liste.filter((m) => passtFilter(m, f.wert)).length}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mandanten-liste-eintraege">
        {sichtbar.map((m) => (
          <button
            type="button"
            key={m.id}
            className={`uebersicht-kategorie ${gewaehltId === m.id ? 'aktiv' : ''} ${m.aktiv ? '' : 'inaktiv'}`}
            onClick={() => waehlen(m.id)}
          >
            <span className="mandanten-name">{m.name}</span>
            <span className="mandanten-liste-nr">{m.potenziell && m.aktiv ? <span className="tag-potenziell">pot.</span> : m.kunden_nr}</span>
          </button>
        ))}
        {sichtbar.length === 0 && <div className="leer-hinweis">Keine Mandanten.</div>}
      </div>
    </div>
  );

  let inhalt = null;
  if (gewaehlt && reiter === 'stamm') {
    const adresse = [gewaehlt.strasse, [gewaehlt.plz, gewaehlt.ort].filter(Boolean).join(' ')].filter(Boolean);
    inhalt = (
      <div className="mandant-stamm">
        <div className="mandant-stamm-raster">
          <section className="mandant-block">
            <h3>Adresse &amp; Kontakt</h3>
            {adresse.length ? adresse.map((z) => <div key={z}>{z}</div>) : <div className="text-gedaempft">Keine Adresse erfasst.</div>}
            {gewaehlt.ansprechperson && <div>z.H. {gewaehlt.ansprechperson}</div>}
            {gewaehlt.telefon && <div>{gewaehlt.telefon}</div>}
            {gewaehlt.email && <div><a href={`mailto:${gewaehlt.email}`}>{gewaehlt.email}</a></div>}
            {gewaehlt.geschaeftsfuehrung_email && <div><a href={`mailto:${gewaehlt.geschaeftsfuehrung_email}`}>{gewaehlt.geschaeftsfuehrung_email}</a> <span className="text-gedaempft">(GF)</span></div>}
          </section>
          <section className="mandant-block">
            <h3>Mandat</h3>
            <div>Kunden-Nr. {gewaehlt.kunden_nr || '–'}{gewaehlt.kuerzel ? ` · Kürzel ${gewaehlt.kuerzel}` : ''}</div>
            <div>{pauschaleMonat > 0 ? `Pauschale CHF ${formatiereCHF(pauschaleMonat)}/Mt.` : 'Keine Pauschale'}</div>
            {eckdaten(gewaehlt).map((z) => <div key={z}>{z}</div>)}
            <div className="mandant-block-aktionen">
              <button type="button" className="btn-klein" onClick={() => setDialog('pauschalen')}>Preise &amp; Pauschalen</button>
              <button type="button" className="btn-klein" onClick={() => navigate(`/rapporte/neu?mandant=${gewaehlt.id}`)}>Detailrapport</button>
            </div>
          </section>
          <section className="mandant-block mandant-block-breit">
            <h3>Ablage</h3>
            {ablage.pfad || ablage.link ? (
              <>
                {ablage.pfad && <div className="mandant-ablage-pfad"><code>{ablage.pfad}</code></div>}
                <div className="mandant-block-aktionen">
                  <AblageKnoepfe mandant={gewaehlt} />
                  {unterstuetzt() && ordner?.length > 0 && <button type="button" className="btn-klein" onClick={ordnerAnlegenKlick}>Ordner in OneDrive anlegen</button>}
                </div>
                {ordnerMeldung && <div className={ordnerMeldung.startsWith('Fehler') ? 'hinweis-fehler' : 'hinweis-erfolg'}>{ordnerMeldung}</div>}
              </>
            ) : (
              <div className="text-gedaempft">
                Noch kein Ablage-Ordner. {grund.grundPfad ? 'Unter «Mandant bearbeiten» den Ordnernamen eintragen.' : 'Zuerst den Grundordner unter Administration › Einstellungen hinterlegen, dann beim Mandanten den Ordnernamen.'}
              </div>
            )}
          </section>
          {gewaehlt.notizen && (
            <section className="mandant-block mandant-block-breit">
              <h3>Notizen</h3>
              <div className="mandant-notizen">{gewaehlt.notizen}</div>
            </section>
          )}
        </div>
        <DateienListe
          mandantId={gewaehlt.id}
          mandant={gewaehlt}
          titel="Dateien des Mandanten"
          hochladenFuer={{ mandantId: gewaehlt.id }}
        />
      </div>
    );
  } else if (gewaehlt && reiter === 'offerten') {
    inhalt = (
      <div>
        <div className="mandant-reiter-kopf">
          <span className="text-gedaempft">Offerten für {gewaehlt.name} – bei Annahme wird das Mandat eröffnet und das Onboarding folgt.</span>
          <button type="button" className="btn btn-primary" onClick={() => navigate(`/offerten/neu?mandant=${gewaehlt.id}&von=mandanten`)}>+ Neue Offerte</button>
        </div>
        <table className="tabelle">
          <thead>
            <tr><th>Angebot-Nr.</th><th>Datum</th><th>Status</th><th className="zahl">Netto/Mt.</th><th>Gültig bis</th><th>Versendet</th></tr>
          </thead>
          <tbody>
            {offertenVon.map((o) => {
              const netto = (o.offert_positionen || []).reduce((s, p) => s + betragMonat(p), 0) * (1 - Number(o.rabatt_prozent || 0) / 100);
              return (
                <tr key={o.id} className="klickbar" onClick={() => navigate(`/offerten/${o.id}?von=mandanten`)}>
                  <td><strong>{o.nummer}</strong></td>
                  <td>{formatiereDatum(o.datum)}</td>
                  <td><span className={`offert-status offert-status-${o.status.toLowerCase()}`}>{o.status}</span></td>
                  <td className="zahl">{chf(netto)}</td>
                  <td>{formatiereDatum(o.gueltig_bis)}</td>
                  <td>{o.versendet_am ? formatiereDatum(o.versendet_am.slice(0, 10)) : '–'}</td>
                </tr>
              );
            })}
            {offertenVon.length === 0 && <tr><td colSpan={6} className="leer-hinweis">Noch keine Offerte.</td></tr>}
          </tbody>
        </table>
        <p className="text-gedaempft mandant-fussnote">Status: {OFFERT_STATUS.join(' → ')}</p>
      </div>
    );
  } else if (gewaehlt && reiter === 'onboarding') {
    const vorgabe = params.get('offerte');
    inhalt = (
      <OnboardingBereich
        key={gewaehlt.id}
        mandant={gewaehlt}
        offerten={offertenVon}
        vorgabeOfferteId={vorgabe ? Number(vorgabe) : null}
        onGeaendert={ladenMandant}
      />
    );
  } else if (gewaehlt && reiter === 'erledigt') {
    inhalt = (
      <table className="tabelle">
        <thead><tr><th>Erledigt am</th><th>Auftrag</th><th className="zahl">Aufwand</th><th>Verrechnung</th></tr></thead>
        <tbody>
          {(erledigte ?? []).map((p) => (
            <tr key={p.id} className="klickbar" onClick={() => setOffenePendenz(p)}>
              <td>{p.erledigt_am ? formatiereDatum(String(p.erledigt_am).slice(0, 10)) : '–'}</td>
              <td>{p.titel}{p.teilaufgaben_gesamt > 0 && <span className="text-gedaempft"> · {p.teilaufgaben_gesamt} Teilschritte</span>}</td>
              <td className="zahl">{p.aufwand_minuten ? formatiereAufwand(p.aufwand_minuten) : '–'}</td>
              <td>{p.verrechnung === 'extra' ? 'Extra' : 'Pauschal'}</td>
            </tr>
          ))}
          {erledigte && erledigte.length === 0 && <tr><td colSpan={4} className="leer-hinweis">Noch keine erledigten Aufträge.</td></tr>}
        </tbody>
      </table>
    );
  }

  return (
    <div className="arbeitsseite">
      <div className="cockpit-kopfzeile">
        <h1 className="seiten-titel">Mandanten</h1>
        <span className="cockpit-kopf-hinweis">Interessent erfassen → Offerte → Onboarding → Mandat.</span>
        <span className="kopfzeile-aktionen">
          <button type="button" className="btn btn-primary" onClick={() => setDialog('neu')}>+ Neuer Mandant</button>
        </span>
      </div>

      <div className="karte mandanten-layout">
        {spalte}
        <div className="mandant-detail">
          {!gewaehlt ? (
            <div className="leer-hinweis" style={{ padding: 32 }}>Links einen Mandanten wählen – oder «+ Neuer Mandant» für einen Interessenten.</div>
          ) : (
            <>
              <div className="mandant-kopf">
                <div>
                  <h2 className="mandant-titel">{gewaehlt.name}</h2>
                  <div className="mandant-phasen">
                    {PHASEN.map((p, i) => (
                      <span key={p.key} className={`mandant-phase ${i < phase ? 'erledigt' : ''} ${i === phase ? 'aktuell' : ''}`}>{p.label}</span>
                    ))}
                    {!gewaehlt.aktiv && <span className="mandant-phase inaktiv">inaktiv</span>}
                  </div>
                </div>
                <button type="button" className="btn" onClick={() => setDialog('bearbeiten')}>Mandant bearbeiten</button>
              </div>
              <div className="uebersicht-reiter mandant-reiter" role="tablist">
                {REITER.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    role="tab"
                    aria-selected={r.key === reiter}
                    className={`uebersicht-kategorie uebersicht-reiter-knopf ${r.key === reiter ? 'aktiv' : ''}`}
                    onClick={() => reiterWaehlen(r.key)}
                  >
                    {r.label}
                    {r.key === 'offerten' && offertenVon.length > 0 && <span className="zaehler-pille">{offertenVon.length}</span>}
                    {r.key === 'erledigt' && erledigte?.length > 0 && <span className="zaehler-pille">{erledigte.length}</span>}
                  </button>
                ))}
              </div>
              <div className="mandant-reiter-inhalt">{inhalt}</div>
            </>
          )}
        </div>
      </div>

      {dialog === 'neu' && (
        <MandantModal
          mandant={null}
          alleMandanten={liste}
          vorgabeStatus="potenziell"
          onSchliessen={() => setDialog(null)}
          onGespeichert={(m) => { setDialog(null); laden(); if (m?.id) { if (filter !== 'alle') filterWaehlen(m.potenziell ? 'potenziell' : 'aktiv'); waehlen(m.id, 'stamm'); } }}
        />
      )}
      {dialog === 'bearbeiten' && gewaehlt && (
        <MandantModal
          mandant={gewaehlt}
          alleMandanten={liste}
          onSchliessen={() => setDialog(null)}
          onGespeichert={() => { setDialog(null); laden(); }}
        />
      )}
      {dialog === 'pauschalen' && gewaehlt && (
        <PauschalenModal
          mandant={gewaehlt}
          onSchliessen={() => setDialog(null)}
          onGeaendert={() => api.pauschalen.liste().then(setPauschalen).catch(() => {})}
        />
      )}
      {offenePendenz && (
        <PendenzModal
          key={offenePendenz.id}
          pendenz={offenePendenz}
          mandanten={mandantenFuerModal}
          mitarbeitende={mitarbeitende}
          onSchliessen={() => setOffenePendenz(null)}
          onGespeichert={() => setOffenePendenz(null)}
          onGeloescht={() => setOffenePendenz(null)}
        />
      )}
    </div>
  );
}
