import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import ZeitModal from '../components/ZeitModal.jsx';
import { useNavigate } from 'react-router-dom';
import api from '../api.js';
import { useMandanten } from '../hooks.js';
import { aufZeitAenderungHoeren } from '../events.js';
import { formatiereDatum, heutigesDatumISO } from '../format.js';
import { chf } from '../lib/offerte.js';
import { formatiereStundenSumme, formatiereDauer, artLabel, betragExtra } from '../lib/zeit.js';
import { zeitraumVon, auswerten, totale } from '../lib/rentabilitaet.js';

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const h = (min) => formatiereStundenSumme(Math.round(min || 0));
const fr = (x) => (x == null ? '–' : chf(x).replace('CHF ', ''));
const prozent = (x) => (x == null ? '–' : `${Math.round(x * 100)} %`);

function Balken({ anteil, ampel }) {
  if (anteil == null) return <span className="text-gedaempft">keine Planzeit</span>;
  return (
    <span className="zv-balken" title={prozent(anteil)}>
      <span className={`zv-balken-fuell zv-${ampel}`} style={{ width: `${Math.min(anteil, 1.5) / 1.5 * 100}%` }} />
      <span className="zv-balken-100" />
      <span className="zv-balken-text">{prozent(anteil)}</span>
    </span>
  );
}

// Zeit & Verrechnung: Pauschal-Zeit gegen offerierte Planzeit (Ampel, effektiver Satz) und die
// noch nicht verrechnete Extra-Zeit pro Mandant -- mit Sprung zum Detailrapport/Rechnung.
export default function ZeitVerrechnung() {
  const heute = heutigesDatumISO();
  const [jahrHeute, monatHeute] = heute.split('-').map(Number);
  const [art, setArt] = useState('jahr');
  const [jahr, setJahr] = useState(jahrHeute);
  const [nr, setNr] = useState(monatHeute);
  const [daten, setDaten] = useState(null);
  const [offen, setOffen] = useState(new Set());
  const [fehler, setFehler] = useState(null);
  const [zeitOffen, setZeitOffen] = useState(null);
  const mandanten = useMandanten();
  const navigate = useNavigate();

  const zeitraum = useMemo(() => zeitraumVon({ art, jahr, nr: art === 'quartal' ? Math.min(nr, 4) : nr }, heute), [art, jahr, nr, heute]);

  const laden = useCallback(() => {
    Promise.all([
      api.zeit.liste({ von: zeitraum.von, bis: zeitraum.bis }),
      api.pauschalen.liste(),
      api.preise.leistungen.liste(),
      api.preise.ansaetze.liste(),
      api.zeit.liste({ art: 'extra' }),
    ]).then(([eintraege, pauschalen, leistungen, ansaetze, extra]) => {
      setDaten({ eintraege, pauschalen, leistungen, ansaetze, offeneExtra: extra.filter((e) => !e.rapport_id) });
      setFehler(null);
    }).catch((e) => setFehler(e.message));
  }, [zeitraum.von, zeitraum.bis]);
  useEffect(() => {
    laden();
    return aufZeitAenderungHoeren(laden);
  }, [laden]);

  const zeilen = useMemo(() => (daten ? auswerten({ ...daten, zeitraum, mandanten }) : []), [daten, zeitraum, mandanten]);
  const eintraegeVon = (mandantId) => {
    if (!daten) return [];
    const imZeitraum = daten.eintraege.filter((e) => e.mandant_id === mandantId && e.minuten != null);
    const ids = new Set(imZeitraum.map((e) => e.id));
    const offenAusserhalb = daten.offeneExtra.filter((e) => e.mandant_id === mandantId && e.minuten != null && !ids.has(e.id));
    return [...imZeitraum, ...offenAusserhalb].sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : b.id - a.id));
  };
  const t = totale(zeilen);
  const intern = (daten?.eintraege ?? []).filter((e) => e.art === 'intern' && e.minuten != null).reduce((s, e) => s + e.minuten, 0);
  const umschalten = (id) => setOffen((alt) => { const n = new Set(alt); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const jahre = [jahrHeute + 1, jahrHeute, jahrHeute - 1, jahrHeute - 2];

  return (
    <div className="offerten-seite zv-seite">
      <div className="cockpit-kopfzeile">
        <h1 className="seiten-titel">Zeit &amp; Verrechnung</h1>
        <span className="cockpit-kopf-hinweis">Pauschal-Zeit gegen offerierte Planzeit · Extra-Zeit verrechnen</span>
        <span className="kopfzeile-aktionen zv-zeitraum">
          {[['monat', 'Monat'], ['quartal', 'Quartal'], ['jahr', 'Jahr']].map(([w, l]) => (
            <button key={w} type="button" className={`btn-klein ${art === w ? 'gewaehlt' : ''}`} onClick={() => { setArt(w); setNr(w === 'quartal' ? Math.ceil(monatHeute / 3) : monatHeute); }}>{l}</button>
          ))}
          {art === 'monat' && <select value={nr} onChange={(e) => setNr(Number(e.target.value))}>{MONATE.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>}
          {art === 'quartal' && <select value={nr} onChange={(e) => setNr(Number(e.target.value))}>{[1, 2, 3, 4].map((q) => <option key={q} value={q}>{q}. Quartal</option>)}</select>}
          <select value={jahr} onChange={(e) => setJahr(Number(e.target.value))}>{jahre.map((j) => <option key={j} value={j}>{j}</option>)}</select>
        </span>
      </div>
      {fehler && <div className="hinweis-fehler">{fehler}</div>}

      <div className="liq-kacheln">
        <div className="liq-kachel">
          <div className="liq-kachel-titel">Pauschal-Zeit</div>
          <div className="liq-kachel-zahl">{h(t.istMinuten)} <span className="zv-von">von {h(t.planMinuten)}</span></div>
          <Balken anteil={t.anteil} ampel={t.anteil == null ? null : t.anteil <= 0.9 ? 'gruen' : t.anteil <= 1.1 ? 'gelb' : 'rot'} />
          <div className="liq-kachel-text">Planzeit laut Pauschalen{zeitraum.laufend ? ` bis ${formatiereDatum(zeitraum.bisPlan)}` : ''}</div>
        </div>
        <div className="liq-kachel">
          <div className="liq-kachel-titel">Effektiver Stundensatz</div>
          <div className="liq-kachel-zahl">{t.satz == null ? '–' : `CHF ${fr(t.satz)}`}</div>
          <div className="liq-kachel-text">Pauschalertrag CHF {fr(t.ertrag)} ÷ Pauschal-Stunden</div>
        </div>
        <div className="liq-kachel">
          <div className="liq-kachel-titel">Extra-Zeit noch nicht verrechnet</div>
          <div className="liq-kachel-zahl liq-plus">CHF {fr(t.offenBetrag)}</div>
          <div className="liq-kachel-text">{h(t.offenMinuten)} über alle Zeiträume</div>
        </div>
        <div className="liq-kachel">
          <div className="liq-kachel-titel">Interne Zeit</div>
          <div className="liq-kachel-zahl">{h(intern)}</div>
          <div className="liq-kachel-text">ohne Mandant, im Zeitraum</div>
        </div>
      </div>

      <div className="karte">
        <table className="tabelle zv-tabelle">
          <thead>
            <tr>
              <th>Mandant / Leistung</th>
              <th className="zahl">Planzeit</th>
              <th className="zahl">Ist Pauschal</th>
              <th>Auslastung</th>
              <th className="zahl">Pauschalertrag</th>
              <th className="zahl">Eff. Satz</th>
              <th className="zahl">Extra im Zeitraum</th>
              <th className="zahl">Extra offen</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {zeilen.map((m) => (
              <MandantZeilen key={m.mandantId} m={m} offen={offen.has(m.mandantId)} onUmschalten={() => umschalten(m.mandantId)}
                eintraege={offen.has(m.mandantId) ? eintraegeVon(m.mandantId) : []} zeitraum={zeitraum} onEintrag={(e) => setZeitOffen(e)}
                onVerrechnen={() => navigate(`/rapporte/neu?mandant=${m.mandantId}&von=${m.offenVon}&bis=${m.offenBis}`)} />
            ))}
            {daten && zeilen.length === 0 && <tr><td colSpan={9} className="leer-hinweis">Keine Pauschalen und keine Zeit im Zeitraum.</td></tr>}
            {!daten && !fehler && <tr><td colSpan={9} className="leer-hinweis">Lädt…</td></tr>}
          </tbody>
        </table>
      </div>
      {zeitOffen && createPortal(
        <ZeitModal eintrag={zeitOffen} onSchliessen={() => setZeitOffen(null)} onGespeichert={() => { setZeitOffen(null); laden(); }} />,
        document.body,
      )}
      <p className="feld-hinweis zv-legende">Ampel: grün bis 90 % der Planzeit, gelb bis 110 %, rot darüber. Planzeit = Menge × Zeit pro Einheit (Preise &amp; Katalog), anteilig für den Zeitraum. Zeit ohne Leistung zählt beim Mandanten, nicht bei einer Leistung.</p>
    </div>
  );
}

function MandantZeilen({ m, offen, onUmschalten, onVerrechnen, eintraege, zeitraum, onEintrag }) {
  const satzKlasse = (satz, ziel) => (satz == null || ziel == null ? '' : satz >= ziel ? 'zv-gut' : satz >= ziel * 0.8 ? 'zv-knapp' : 'zv-tief');
  return (
    <>
      <tr className="zv-mandant klickbar" onClick={onUmschalten}>
        <td><span className="zv-pfeil">{offen ? '▾' : '▸'}</span> <strong>{m.name}</strong></td>
        <td className="zahl">{h(m.planMinuten)}</td>
        <td className="zahl">{h(m.istMinuten)}</td>
        <td><Balken anteil={m.anteil} ampel={m.ampel} /></td>
        <td className="zahl">{fr(m.ertrag)}</td>
        <td className="zahl">{m.satz == null ? '–' : fr(m.satz)}</td>
        <td className="zahl">{m.extraMinuten ? `${h(m.extraMinuten)} · ${fr(m.extraBetrag)}` : '–'}</td>
        <td className="zahl">{m.offenMinuten ? <strong className="liq-plus">{fr(m.offenBetrag)}</strong> : '–'}</td>
        <td className="spalte-aktionen" onClick={(e) => e.stopPropagation()}>
          {m.offenMinuten > 0 && <button type="button" className="btn-klein btn-klein-primaer" onClick={onVerrechnen}>Verrechnen</button>}
        </td>
      </tr>
      {offen && m.leistungen.map((l) => (
        <tr key={l.leistungId ?? 0} className="zv-leistung">
          <td>{l.name}</td>
          <td className="zahl">{h(l.planMinuten)}</td>
          <td className="zahl">{h(l.istMinuten)}</td>
          <td><Balken anteil={l.anteil} ampel={l.ampel} /></td>
          <td className="zahl">{fr(l.ertrag)}</td>
          <td className={`zahl ${satzKlasse(l.satz, l.zielsatz)}`} title={l.zielsatz ? `Zielsatz CHF ${fr(l.zielsatz)}` : undefined}>{l.satz == null ? '–' : fr(l.satz)}</td>
          <td colSpan={3} className="text-gedaempft">{l.zielsatz ? `Ziel ${fr(l.zielsatz)}/h` : ''}</td>
        </tr>
      ))}
      {offen && m.leistungen.length === 0 && <tr className="zv-leistung"><td colSpan={9} className="text-gedaempft">Keine Pauschal-Leistungen.</td></tr>}
      {offen && (
        <tr className="zv-eintraege-zeile">
          <td colSpan={9}>
            <div className="zv-eintraege-titel">
              Erfasste Zeit ({eintraege.length}) · Klick auf einen Eintrag zum Korrigieren, z.B. Pauschal ↔ Extra
            </div>
            <table className="tabelle zv-eintraege">
              <thead><tr><th>Datum</th><th>Arbeit</th><th>Leistung</th><th>Person</th><th>Art</th><th className="zahl">Dauer</th><th className="zahl">CHF</th><th>Status</th></tr></thead>
              <tbody>
                {eintraege.map((e) => {
                  const ausserhalb = e.datum < zeitraum.von || e.datum > zeitraum.bis;
                  return (
                    <tr key={e.id} className={`klickbar ${e.rapport_id ? 'zv-verrechnet' : ''}`} onClick={() => onEintrag(e)}>
                      <td>{formatiereDatum(e.datum)}{ausserhalb && <span className="text-gedaempft" title="ausserhalb des Zeitraums, aber noch offen"> *</span>}</td>
                      <td>{e.beschreibung || e.pendenzen?.titel || '–'}</td>
                      <td>{e.leistungen?.name ?? '–'}</td>
                      <td>{e.mitarbeitende?.name ?? ''}</td>
                      <td><span className={`zeit-art zeit-art-${e.art}`}>{artLabel(e.art)}</span></td>
                      <td className="zahl">{formatiereDauer(e.minuten)}</td>
                      <td className="zahl">{e.art === 'extra' ? fr(betragExtra(e)) : ''}</td>
                      <td>{e.rapport_id ? <span className="text-gedaempft">verrechnet</span> : e.art === 'extra' ? <strong className="liq-plus">offen</strong> : ''}</td>
                    </tr>
                  );
                })}
                {eintraege.length === 0 && <tr><td colSpan={8} className="leer-hinweis">Keine Zeit im Zeitraum.</td></tr>}
              </tbody>
            </table>
            {eintraege.some((e) => e.datum < zeitraum.von || e.datum > zeitraum.bis) && <div className="feld-hinweis">* noch nicht verrechnete Extra-Zeit ausserhalb des gewählten Zeitraums</div>}
          </td>
        </tr>
      )}
    </>
  );
}
