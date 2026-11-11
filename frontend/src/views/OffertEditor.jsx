import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../api.js';
import OffertDokument from '../components/OffertDokument.jsx';
import FormularModal from '../components/FormularModal.jsx';
import MandantModal from '../components/MandantModal.jsx';
import MandantSuche from '../components/MandantSuche.jsx';
import BuchungsAnalyse from '../components/BuchungsAnalyse.jsx';
import { useMitarbeitende } from '../hooks.js';
import { useAuth } from '../AuthContext.jsx';
import { meldeMandantenAenderung } from '../events.js';
import { heutigesDatumISO, datumPlusTage, formatiereDatum } from '../format.js';
import {
  positionAusLeistung, positionAusModul, betragMonat, totale, planung, naechsteNummer,
  pauschalenAusOfferte, textErsetzen, chf,
} from '../lib/offerte.js';
import { aktivePauschalen, formatiereMinuten, formatiereTage, zielansatz, maxMinuten } from '../lib/preise.js';
import { elementZuPdf, herunterladen } from '../lib/pdf.js';

let schluesselZaehler = 0;
const mitSchluessel = (p) => ({ ...p, _k: ++schluesselZaehler });

function ersterNaechsterMonat(heute) {
  const [j, m] = heute.split('-').map(Number);
  const d = new Date(j, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// Offerte erstellen/bearbeiten: links Kopf und Positionen, rechts die Offerte als A4-Vorschau
// (identisch mit Druck und PDF). Annahme eroeffnet das Mandat (Pauschalen, Mandant aktiv).
export default function OffertEditor() {
  const { id } = useParams();
  const neu = id === 'neu';
  const [suchParameter] = useSearchParams();
  const vonMandant = suchParameter.get('von') === 'mandanten';
  const navigate = useNavigate();
  const { benutzer } = useAuth();
  const mitarbeitende = useMitarbeitende();
  const dokumentRef = useRef(null);

  const [kopf, setKopf] = useState(null);
  const [positionen, setPositionen] = useState([]);
  const [mandanten, setMandanten] = useState([]);
  const [leistungen, setLeistungen] = useState([]);
  const [module, setModule] = useState([]);
  const [ansaetze, setAnsaetze] = useState([]);
  const [firma, setFirma] = useState({});
  const [texte, setTexte] = useState({});
  const [pauschalenMandant, setPauschalenMandant] = useState([]);
  const [geaendert, setGeaendert] = useState(false);
  const [fehler, setFehler] = useState(null);
  const [meldung, setMeldung] = useState(null);
  const [beschaeftigt, setBeschaeftigt] = useState(null);
  const [dialog, setDialog] = useState(null); // 'mail' | 'annahme' | 'mandant'
  const [neuerName, setNeuerName] = useState('');

  const ladeMandanten = useCallback(() => api.mandanten.liste().then(setMandanten), []);

  useEffect(() => {
    let abgebrochen = false;
    (async () => {
      try {
        const [m, l, mo, a, f, t, alle] = await Promise.all([
          api.mandanten.liste(), api.preise.leistungen.liste(), api.preise.abacusModule.liste(), api.preise.ansaetze.liste(),
          api.buero.lesen('firma'), api.buero.lesen('offerte'), neu ? api.offerten.liste() : Promise.resolve([]),
        ]);
        if (abgebrochen) return;
        setMandanten(m); setLeistungen(l); setModule(mo); setAnsaetze(a); setFirma(f); setTexte(t);
        if (neu) {
          const heute = heutigesDatumISO();
          setKopf({
            nummer: naechsteNummer(alle, Number(heute.slice(0, 4))), mandant_id: suchParameter.get('mandant') || '',
            datum: heute, gueltig_bis: datumPlusTage(heute, Number(t.gueltigTage) || 30), bearbeiter_id: benutzer?.id ?? '',
            mwst_pflichtig: true, mwst_satz: 8.1, rabatt_prozent: 0, skonto_prozent: 0, skonto_tage: 10, status: 'Entwurf', notiz: '',
          });
          setPositionen([]);
        } else {
          const { kopf: k, positionen: p } = await api.offerten.holen(Number(id));
          if (abgebrochen) return;
          setKopf({ ...k, bearbeiter_id: k.bearbeiter_id ?? '', skonto_tage: k.skonto_tage ?? '' });
          setPositionen(p.map(mitSchluessel));
        }
      } catch (e) {
        if (!abgebrochen) setFehler(e.message);
      }
    })();
    return () => { abgebrochen = true; };
    // Nur beim Oeffnen einer (anderen) Offerte laden.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!kopf?.mandant_id) { setPauschalenMandant([]); return; }
    api.pauschalen.liste(Number(kopf.mandant_id)).then(setPauschalenMandant).catch(() => setPauschalenMandant([]));
  }, [kopf?.mandant_id]);

  if (fehler && !kopf) return <div className="fehleranzeige">Fehler beim Laden: {fehler}</div>;
  if (!kopf) return <div className="leer-hinweis">Lade…</div>;

  const mandant = mandanten.find((m) => String(m.id) === String(kopf.mandant_id));
  const bearbeiter = mitarbeitende.find((m) => String(m.id) === String(kopf.bearbeiter_id))?.name;
  const t = totale(positionen, kopf);
  const plan = planung(positionen, kopf);
  const standard = ansaetze.find((a) => a.ist_standard);
  // Stunden, die die Monatspauschale (nach Rabatt) beim Zielansatz je Leistung deckt.
  const rabattFaktor = 1 - Number(kopf.rabatt_prozent || 0) / 100;
  const maxStd = positionen.filter((p) => !p.ist_lizenz && p.leistung_id).reduce((s, p) => {
    const l = leistungen.find((x) => x.id === p.leistung_id);
    return s + (maxMinuten(betragMonat(p) * rabattFaktor, zielansatz(l, ansaetze)) ?? 0);
  }, 0);
  const dienstleistungen = positionen.filter((p) => !p.ist_lizenz);
  const lizenzen = positionen.filter((p) => p.ist_lizenz);
  const dateiname = `Angebot ${kopf.nummer}${mandant ? ` ${mandant.name}` : ''}.pdf`.replace(/[\\/:*?"<>|]/g, '');

  function kopfAendern(feld, wert) {
    setKopf((k) => ({ ...k, [feld]: wert }));
    setGeaendert(true);
  }
  function positionAendern(k, patch) {
    setPositionen((liste) => liste.map((p) => (p._k === k ? { ...p, ...patch } : p)));
    setGeaendert(true);
  }
  function positionErsetzen(k, katalogId, istLizenz) {
    const eintrag = (istLizenz ? module : leistungen).find((x) => String(x.id) === katalogId);
    if (!eintrag) return;
    setPositionen((liste) => liste.map((p) => {
      if (p._k !== k) return p;
      const neuePos = istLizenz ? positionAusModul(eintrag, p.menge || 1) : positionAusLeistung(eintrag, ansaetze, p.menge);
      return { ...neuePos, _k: k };
    }));
    setGeaendert(true);
  }
  function positionHinzufuegen(istLizenz) {
    const leer = { leistung_id: null, abacus_modul_id: null, bezeichnung: '', einheit: '', turnus: 'monatlich', menge: istLizenz ? 1 : '', preis_pro_einheit: 0, minuten_pro_einheit: null, angebot_gruppe: null, ist_lizenz: istLizenz };
    setPositionen((liste) => [...liste, mitSchluessel(leer)]);
    setGeaendert(true);
  }
  // Menge aus der Auswertung des Buchungsjournals: bestehende Position anpassen oder neu anlegen.
  function mengeAusJournal(leistung, menge) {
    const vorhanden = positionen.find((p) => !p.ist_lizenz && p.leistung_id === leistung.id);
    if (vorhanden) positionAendern(vorhanden._k, { menge: String(menge) });
    else {
      setPositionen((liste) => [...liste, mitSchluessel(positionAusLeistung(leistung, ansaetze, menge))]);
      setGeaendert(true);
    }
    setMeldung(`${menge} Belege pro Monat bei «${leistung.name}» übernommen.`);
  }
  function positionEntfernen(k) {
    setPositionen((liste) => liste.filter((p) => p._k !== k));
    setGeaendert(true);
  }
  function verschieben(k, richtung) {
    setPositionen((liste) => {
      const i = liste.findIndex((p) => p._k === k);
      const gruppe = liste[i].ist_lizenz;
      let j = i + richtung;
      while (j >= 0 && j < liste.length && liste[j].ist_lizenz !== gruppe) j += richtung;
      if (j < 0 || j >= liste.length) return liste;
      const kopie = [...liste];
      [kopie[i], kopie[j]] = [kopie[j], kopie[i]];
      return kopie;
    });
    setGeaendert(true);
  }

  // Speichert und liefert die gespeicherte Offerte (fuer Mail/Annahme vorher noetig).
  async function speichern() {
    const ohneAuswahl = positionen.filter((p) => !p.bezeichnung);
    if (ohneAuswahl.length) throw new Error('Bitte bei jeder Position eine Leistung bzw. ein Modul wählen (oder die leere Zeile entfernen).');
    const gespeichert = await api.offerten.speichern(neu ? null : Number(id), kopf, positionen);
    setKopf((k) => ({ ...k, ...gespeichert, bearbeiter_id: gespeichert.bearbeiter_id ?? '', skonto_tage: gespeichert.skonto_tage ?? '' }));
    setGeaendert(false);
    if (neu) navigate(`/offerten/${gespeichert.id}${vonMandant ? '?von=mandanten' : ''}`, { replace: true });
    return gespeichert;
  }

  async function aktion(name, fn) {
    setBeschaeftigt(name);
    setFehler(null);
    setMeldung(null);
    try {
      await fn();
    } catch (e) {
      setFehler(e.message);
    } finally {
      setBeschaeftigt(null);
    }
  }

  const speichernKlick = () => aktion('speichern', async () => { await speichern(); setMeldung('Gespeichert.'); });
  const drucken = () => window.print();
  const pdfLaden = () => aktion('pdf', async () => {
    const { blob } = await elementZuPdf(dokumentRef.current);
    herunterladen(blob, dateiname);
  });

  async function statusSetzen(status) {
    await aktion('status', async () => {
      const o = geaendert || neu ? await speichern() : kopf;
      await api.offerten.status(o.id, status);
      setKopf((k) => ({ ...k, status }));
      setMeldung(`Status: ${status}.`);
    });
  }

  async function loeschen() {
    if (!window.confirm(`Offerte ${kopf.nummer} löschen?`)) return;
    await aktion('loeschen', async () => {
      await api.offerten.loeschen(kopf.id);
      navigate(vonMandant ? `/mandanten?mandant=${kopf.mandant_id}&reiter=offerten` : '/offerten');
    });
  }

  const platzhalter = {
    nummer: kopf.nummer, firma: firma.firma || '', mandant: mandant?.name || '',
    ansprechperson: mandant?.ansprechperson || '', gueltigBis: formatiereDatum(kopf.gueltig_bis), bearbeiter: bearbeiter || '',
  };

  function mailDialog() {
    const adressen = [mandant?.email, mandant?.geschaeftsfuehrung_email].filter(Boolean);
    return (
      <FormularModal
        titel={`Offerte ${kopf.nummer} per E-Mail senden`}
        breit
        mail
        speichernText="Senden"
        startwerte={{
          an: adressen[0] || '', cc: '', bcc: '',
          betreff: textErsetzen(texte.mailBetreff || 'Angebot {nummer} – {firma}', platzhalter),
          text: textErsetzen(texte.mailText || '', platzhalter),
        }}
        felder={[
          { name: 'an', label: 'An', typ: 'text', pflicht: true, auswahl: () => [
              mandant?.email && { label: 'Ansprechperson', wert: mandant.email },
              mandant?.geschaeftsfuehrung_email && { label: 'Geschäftsführung', wert: mandant.geschaeftsfuehrung_email },
            ].filter(Boolean),
            hinweis: adressen.length ? 'Klick auf eine hinterlegte Adresse setzt sie ein.' : 'Beim Mandanten ist keine E-Mail hinterlegt.' },
          { name: 'cc', label: 'CC', typ: 'text', halb: true, platzhalter: 'optional, mehrere mit ; trennen' },
          { name: 'bcc', label: 'BCC', typ: 'text', halb: true, platzhalter: 'optional' },
          { name: 'betreff', label: 'Betreff', typ: 'text', pflicht: true },
          { name: 'text', label: 'Text', typ: 'textarea', pflicht: true, hinweis: 'Signatur mit Logo wird automatisch angehängt (Arial 10).' },
        ]}
        vorschau={() => `Anhang: ${dateiname}`}
        onSpeichern={async (f) => {
          const o = geaendert || neu ? await speichern() : kopf;
          const { base64 } = await elementZuPdf(dokumentRef.current);
          await api.offerten.versenden({ ...kopf, ...o }, { an: f.an, cc: f.cc, bcc: f.bcc, betreff: f.betreff, text: f.text, pdfBase64: base64, dateiname });
          setKopf((k) => ({ ...k, status: k.status === 'Entwurf' ? 'Versendet' : k.status, versendet_an: f.an, versendet_am: new Date().toISOString() }));
          setDialog(null);
          setMeldung(`Offerte an ${f.an} gesendet.`);
        }}
        onSchliessen={() => setDialog(null)}
      />
    );
  }

  function annahmeDialog() {
    const heute = heutigesDatumISO();
    const neuePauschalen = pauschalenAusOfferte(kopf, positionen);
    const bisherige = aktivePauschalen(pauschalenMandant, heute);
    const summe = neuePauschalen.reduce((s, p) => s + p.betrag_monat, 0);
    return (
      <FormularModal
        titel={`Offerte ${kopf.nummer} angenommen – Mandat eröffnen`}
        speichernText="Mandat eröffnen"
        startwerte={{ ab: ersterNaechsterMonat(heute), bisherigeBeenden: bisherige.length > 0 }}
        felder={[
          { name: 'ab', label: 'Pauschalen gültig ab', typ: 'datum', pflicht: true },
          ...(bisherige.length ? [{ name: 'bisherigeBeenden', label: `Bisherige ${bisherige.length} Pauschale(n) per Vortag beenden`, typ: 'checkbox' }] : []),
        ]}
        vorschau={() => [
          `${neuePauschalen.length} Pauschale(n) für ${mandant?.name}, total ${chf(summe)}/Mt. (nach Rabatt, exkl. MWST).`,
          mandant?.potenziell ? 'Der Mandant wird von «Potenziell» auf «Aktiv» gesetzt.' : null,
        ].filter(Boolean).join(' ')}
        onSpeichern={async (f) => {
          const o = geaendert || neu ? await speichern() : kopf;
          await api.offerten.annehmen({ ...kopf, ...o }, neuePauschalen, { ab: f.ab, bisherigeBeenden: !!f.bisherigeBeenden });
          meldeMandantenAenderung();
          await ladeMandanten();
          setKopf((k) => ({ ...k, status: 'Angenommen', angenommen_am: heute, pauschalen_ab: f.ab }));
          setDialog(null);
          setMeldung(`Mandat eröffnet: ${neuePauschalen.length} Pauschale(n) ab ${formatiereDatum(f.ab)} beim Mandanten hinterlegt.`);
        }}
        onSchliessen={() => setDialog(null)}
      />
    );
  }


  function positionsTabelle(liste, istLizenz) {
    const katalog = (istLizenz ? module : leistungen).filter((x) => x.aktiv || liste.some((p) => (istLizenz ? p.abacus_modul_id : p.leistung_id) === x.id));
    return (
      <table className="tabelle offert-pos-tabelle">
        <thead>
          <tr>
            <th>{istLizenz ? 'Modul' : 'Dienstleistung'}</th><th className="zahl">Menge</th><th>Einh.</th>
            <th className="zahl">CHF/Einh.</th><th className="zahl">CHF/Mt.</th><th></th>
          </tr>
        </thead>
        <tbody>
          {liste.map((p) => (
            <tr key={p._k}>
              <td>
                <select
                  value={String((istLizenz ? p.abacus_modul_id : p.leistung_id) ?? '')}
                  onChange={(e) => positionErsetzen(p._k, e.target.value, istLizenz)}
                  aria-label="Position wählen"
                >
                  <option value="">{p.bezeichnung && !(istLizenz ? p.abacus_modul_id : p.leistung_id) ? p.bezeichnung : '– wählen –'}</option>
                  {katalog.map((x) => <option key={x.id} value={String(x.id)}>{x.name}</option>)}
                </select>
                {p.angebot_gruppe && <div className="offert-pos-zusatz">in Angebot als «{p.angebot_gruppe}»</div>}
              </td>
              <td className="zahl">
                <input type="number" min="0" step="any" className="offert-zahl-eingabe" value={p.menge} onChange={(e) => positionAendern(p._k, { menge: e.target.value })} aria-label="Menge" />
              </td>
              <td>{p.einheit}{p.turnus === 'jaehrlich' ? '/Jahr' : ''}</td>
              <td className="zahl">
                <input type="number" min="0" step="0.05" className="offert-zahl-eingabe" value={p.preis_pro_einheit} onChange={(e) => positionAendern(p._k, { preis_pro_einheit: e.target.value })} aria-label="Preis pro Einheit" />
              </td>
              <td className="zahl">{chf(betragMonat(p)).replace('CHF ', '')}</td>
              <td className="offert-pos-aktionen">
                <button type="button" className="btn-symbol" onClick={() => verschieben(p._k, -1)} title="nach oben">↑</button>
                <button type="button" className="btn-symbol" onClick={() => verschieben(p._k, 1)} title="nach unten">↓</button>
                <button type="button" className="btn-symbol" onClick={() => positionEntfernen(p._k)} title="entfernen">×</button>
              </td>
            </tr>
          ))}
          {liste.length === 0 && <tr><td colSpan={6} className="leer-hinweis">Noch keine Positionen.</td></tr>}
        </tbody>
      </table>
    );
  }

  const satzAmpel = plan.satz == null || !standard ? '' : plan.satz >= Number(standard.chf_pro_stunde) ? 'gut' : plan.satz >= 0.85 * Number(standard.chf_pro_stunde) ? 'knapp' : 'tief';

  return (
    <div className="offert-editor">
      <div className="cockpit-kopfzeile offert-kopfzeile">
        <button type="button" className="btn-klein" onClick={() => (!geaendert || window.confirm('Ungespeicherte Änderungen verwerfen?')) && navigate(vonMandant ? `/mandanten?mandant=${kopf.mandant_id}&reiter=offerten` : '/offerten')}>
          {vonMandant ? '← Mandant' : '← Offerten'}
        </button>
        <h1 className="seiten-titel">Offerte {kopf.nummer}</h1>
        <span className={`offert-status offert-status-${kopf.status.toLowerCase()}`}>{kopf.status}</span>
        {geaendert && <span className="cockpit-kopf-hinweis">ungespeichert</span>}
        <span className="kopfzeile-aktionen">
          <button type="button" className="btn btn-primary" onClick={speichernKlick} disabled={!!beschaeftigt}>{beschaeftigt === 'speichern' ? 'Speichert…' : 'Speichern'}</button>
          <button type="button" className="btn" onClick={drucken}>Drucken</button>
          <button type="button" className="btn" onClick={pdfLaden} disabled={!!beschaeftigt}>{beschaeftigt === 'pdf' ? 'PDF…' : 'PDF'}</button>
          <button type="button" className="btn" onClick={() => setDialog('mail')} disabled={!mandant || !!beschaeftigt}>Per E-Mail senden</button>
          {kopf.status !== 'Angenommen' && (
            <button type="button" className="btn" onClick={() => setDialog('annahme')} disabled={!mandant || positionen.length === 0 || !!beschaeftigt}>Angenommen…</button>
          )}
          {!['Angenommen', 'Abgelehnt'].includes(kopf.status) && (
            <button type="button" className="btn" onClick={() => statusSetzen('Abgelehnt')} disabled={!!beschaeftigt || neu}>Abgelehnt</button>
          )}
          {!neu && kopf.status !== 'Angenommen' && <button type="button" className="btn btn-gefahr" onClick={loeschen} disabled={!!beschaeftigt}>Löschen</button>}
        </span>
      </div>
      {fehler && <div className="hinweis-fehler">{fehler}</div>}
      {meldung && <div className="hinweis-erfolg">{meldung}</div>}
      {kopf.status === 'Angenommen' && !neu && (
        <div className="offert-hinweis">
          Offerte angenommen – nächster Schritt ist das Onboarding (DL-Vertrag, Vollmacht, EBICS …).{' '}
          <button type="button" className="btn-klein btn-klein-primaer" onClick={() => navigate(`/mandanten?mandant=${kopf.mandant_id}&reiter=onboarding&offerte=${kopf.id}`)}>
            Onboarding öffnen →
          </button>
        </div>
      )}
      {kopf.versendet_am && <div className="offert-hinweis">Versendet am {formatiereDatum(kopf.versendet_am.slice(0, 10))} an {kopf.versendet_an}.</div>}
      {kopf.status === 'Angenommen' && kopf.pauschalen_ab && <div className="offert-hinweis">Angenommen – Pauschalen ab {formatiereDatum(kopf.pauschalen_ab)} beim Mandanten hinterlegt. Weitere Änderungen hier ändern die Pauschalen nicht mehr.</div>}

      <div className="offert-arbeitsbereich">
        <div className="offert-formular">
          <div className="karte offert-karte">
            <div className="karte-kopf">Mandant &amp; Angebot</div>
            <div className="modal-koerper">
              <div className="feld">
                <label htmlFor="of-mandant">Mandant *</label>
                <div className="feld-inline">
                  <MandantSuche
                    id="of-mandant"
                    mandanten={mandanten}
                    wert={kopf.mandant_id}
                    onWahl={(wert) => kopfAendern('mandant_id', wert)}
                    onNeu={(text) => { setNeuerName(text.trim()); setDialog('mandant'); }}
                  />
                  <button type="button" className="btn-klein" onClick={() => { setNeuerName(''); setDialog('mandant'); }}>+ Interessent</button>
                </div>
                {mandant && !mandant.strasse && <p className="feld-hinweis">Adresse fehlt – im Kundenstamm ergänzen, damit sie auf der Offerte steht.</p>}
              </div>
              <div className="feld-reihe">
                <div className="feld"><label htmlFor="of-nummer">Angebot-Nr.</label><input id="of-nummer" value={kopf.nummer} onChange={(e) => kopfAendern('nummer', e.target.value)} /></div>
                <div className="feld">
                  <label htmlFor="of-bearbeiter">Bearbeiter</label>
                  <select id="of-bearbeiter" value={String(kopf.bearbeiter_id)} onChange={(e) => kopfAendern('bearbeiter_id', e.target.value)}>
                    <option value="">–</option>
                    {mitarbeitende.filter((m) => m.aktiv || String(m.id) === String(kopf.bearbeiter_id)).map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="feld-reihe">
                <div className="feld"><label htmlFor="of-datum">Datum</label><input id="of-datum" type="date" value={kopf.datum} onChange={(e) => kopfAendern('datum', e.target.value)} /></div>
                <div className="feld"><label htmlFor="of-gueltig">Gültig bis</label><input id="of-gueltig" type="date" value={kopf.gueltig_bis} onChange={(e) => kopfAendern('gueltig_bis', e.target.value)} /></div>
              </div>
              <div className="feld-reihe offert-reihe-4">
                <div className="feld"><label htmlFor="of-rabatt">Rabatt %</label><input id="of-rabatt" type="number" min="0" max="100" step="0.5" value={kopf.rabatt_prozent} onChange={(e) => kopfAendern('rabatt_prozent', e.target.value)} /></div>
                <div className="feld"><label htmlFor="of-skonto">Skonto %</label><input id="of-skonto" type="number" min="0" max="100" step="0.5" value={kopf.skonto_prozent} onChange={(e) => kopfAendern('skonto_prozent', e.target.value)} /></div>
                <div className="feld"><label htmlFor="of-skontotage">Skonto Tage</label><input id="of-skontotage" type="number" min="0" value={kopf.skonto_tage} onChange={(e) => kopfAendern('skonto_tage', e.target.value)} /></div>
                <div className="feld">
                  <label htmlFor="of-mwst">MWST</label>
                  <select id="of-mwst" value={kopf.mwst_pflichtig ? '1' : '0'} onChange={(e) => kopfAendern('mwst_pflichtig', e.target.value === '1')}>
                    <option value="1">{kopf.mwst_satz} %</option>
                    <option value="0">keine</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div className="karte offert-karte">
            <div className="karte-kopf">Dienstleistungen</div>
            <BuchungsAnalyse leistungen={leistungen} onUebernehmen={mengeAusJournal} />
            {positionsTabelle(dienstleistungen, false)}
            <div className="offert-karte-fuss"><button type="button" className="btn-klein" onClick={() => positionHinzufuegen(false)}>+ Dienstleistung</button></div>
          </div>

          <div className="karte offert-karte">
            <div className="karte-kopf">ABACUS-Module</div>
            {positionsTabelle(lizenzen, true)}
            <div className="offert-karte-fuss"><button type="button" className="btn-klein" onClick={() => positionHinzufuegen(true)}>+ ABACUS-Modul</button></div>
          </div>

          <div className="karte offert-karte">
            <div className="karte-kopf">Kalkulation</div>
            <table className="tabelle offert-kalkulation">
              <tbody>
                <tr><td>Netto pro Monat (Listenpreis)</td><td className="zahl">{chf(t.netto)}</td></tr>
                <tr><td>Rabatt {Number(kopf.rabatt_prozent) || 0} %</td><td className="zahl">{chf(-t.rabatt)}</td></tr>
                <tr><td><strong>Monatspauschale nach Rabatt</strong></td><td className="zahl"><strong>{chf(t.nettoNachRabatt)}</strong></td></tr>
                <tr><td>pro Jahr</td><td className="zahl">{chf(t.jahr)}</td></tr>
                <tr>
                  <td>Planzeit pro Monat{plan.ohneZeit ? ` (${plan.ohneZeit} Position${plan.ohneZeit > 1 ? 'en' : ''} ohne Zeit im Katalog)` : ''}</td>
                  <td className="zahl">{plan.minuten ? formatiereMinuten(plan.minuten) : '–'}</td>
                </tr>
                <tr>
                  <td>Max. Stunden pro Monat (Preis ÷ Zielansatz je Leistung, 1 Tag = 8 Std.)</td>
                  <td className="zahl">{maxStd ? `${formatiereMinuten(maxStd)} · ${formatiereTage(maxStd)}` : '–'}</td>
                </tr>
                <tr>
                  <td>Ertrag pro Planstunde{standard ? ` (Ziel ${chf(standard.chf_pro_stunde)})` : ''}</td>
                  <td className={`zahl offert-ampel-${satzAmpel}`}>{plan.satz == null ? '–' : chf(plan.satz)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="feld">
            <label htmlFor="of-notiz">Interne Notiz (nicht auf der Offerte)</label>
            <textarea id="of-notiz" value={kopf.notiz ?? ''} onChange={(e) => kopfAendern('notiz', e.target.value)} />
          </div>
        </div>

        <div className="offert-vorschau">
          <div className="offert-vorschau-skala druck-ziel">
            <OffertDokument
              ref={dokumentRef}
              offerte={kopf}
              positionen={positionen}
              mandant={mandant}
              bearbeiter={bearbeiter}
              firma={firma}
              texte={texte}
            />
          </div>
        </div>
      </div>

      {dialog === 'mail' && mailDialog()}
      {dialog === 'annahme' && annahmeDialog()}
      {dialog === 'mandant' && (
        <MandantModal
          mandant={null}
          alleMandanten={mandanten}
          vorgabeStatus="potenziell"
          vorgabeName={neuerName}
          onSchliessen={() => setDialog(null)}
          onGespeichert={async (m) => {
            setDialog(null);
            await ladeMandanten();
            kopfAendern('mandant_id', String(m.id));
          }}
        />
      )}
    </div>
  );
}

