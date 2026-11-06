import { useCallback, useEffect, useState } from 'react';
import api from '../api.js';
import FormularModal from '../components/FormularModal.jsx';
import {
  TURNUS, PREIS_ARTEN, EINHEITEN_VORSCHLAG, turnusLabel, preisProEinheit, formatiereCHF, formatiereMinuten,
} from '../lib/preise.js';

const STATUS_OPTIONEN = [{ wert: '1', label: 'Aktiv' }, { wert: '0', label: 'Inaktiv' }];
const wertOderLeer = (w) => (w == null ? '' : String(w));
const ZEILENUMBRUCH = '\n';

// Preise (v7, Etappe 1): Stundenansaetze, Leistungskatalog und ABACUS-Module -- ersetzt die
// Blaetter "Dienstleistungen" und "ABACUS Module" des bisherigen Excel-Preiskalkulators.
export default function Preise() {
  const [ansaetze, setAnsaetze] = useState([]);
  const [leistungen, setLeistungen] = useState([]);
  const [module, setModule] = useState([]);
  const [fehler, setFehler] = useState(null);
  const [offen, setOffen] = useState(null); // { art: 'ansatz'|'leistung'|'modul'|'vorlage', eintrag }
  const [firma, setFirma] = useState({});
  const [texte, setTexte] = useState({});

  const laden = useCallback(() => {
    Promise.all([api.preise.ansaetze.liste(), api.preise.leistungen.liste(), api.preise.abacusModule.liste()])
      .then(([a, l, m]) => { setAnsaetze(a); setLeistungen(l); setModule(m); setFehler(null); })
      .catch((e) => setFehler(e.message));
    Promise.all([api.buero.lesen('firma'), api.buero.lesen('offerte')])
      .then(([f, t]) => { setFirma(f); setTexte(t); }).catch(() => {});
  }, []);

  useEffect(() => { laden(); }, [laden]);

  const schliessen = () => setOffen(null);
  const nachAktion = async (aktion) => { await aktion(); setOffen(null); laden(); };
  const ansatzName = (id) => ansaetze.find((a) => a.id === id)?.name ?? '–';

  function ansatzFenster(eintrag) {
    return (
      <FormularModal
        titel={eintrag ? 'Stundenansatz bearbeiten' : 'Neuer Stundenansatz'}
        startwerte={{
          name: eintrag?.name ?? '', chfProStunde: wertOderLeer(eintrag?.chf_pro_stunde),
          istStandard: eintrag?.ist_standard ?? ansaetze.length === 0, aktiv: eintrag ? (eintrag.aktiv ? '1' : '0') : '1',
        }}
        felder={[
          { name: 'name', label: 'Name', typ: 'text', pflicht: true, platzhalter: 'z.B. Standard' },
          { name: 'chfProStunde', label: 'CHF pro Stunde', typ: 'zahl', pflicht: true, halb: true, schritt: '0.05' },
          { name: 'aktiv', label: 'Status', typ: 'select', optionen: STATUS_OPTIONEN, leer: false, halb: true },
          { name: 'istStandard', label: 'Standardansatz (Zielsatz für die Rentabilität, Ansatz für Extra-Arbeiten)', typ: 'checkbox' },
        ]}
        onSpeichern={(f) => nachAktion(() => api.preise.ansaetze.speichern(eintrag?.id, { ...f, aktiv: f.aktiv === '1' }))}
        onLoeschen={eintrag ? () => nachAktion(() => api.preise.ansaetze.loeschen(eintrag.id)) : undefined}
        loeschenText={`Stundenansatz «${eintrag?.name}» löschen?`}
        onSchliessen={schliessen}
      />
    );
  }

  function leistungFenster(eintrag) {
    const aktiveAnsaetze = ansaetze.filter((a) => a.aktiv || a.id === eintrag?.stundenansatz_id);
    const standard = ansaetze.find((a) => a.ist_standard);
    const gruppen = [...new Set(leistungen.map((l) => l.angebot_gruppe).filter(Boolean))];
    return (
      <FormularModal
        titel={eintrag ? 'Leistung bearbeiten' : 'Neue Leistung'}
        startwerte={{
          name: eintrag?.name ?? '', einheit: eintrag?.einheit ?? '', turnus: eintrag?.turnus ?? 'monatlich',
          preisArt: eintrag?.preis_art ?? 'zeit', minutenProEinheit: wertOderLeer(eintrag?.minuten_pro_einheit),
          stundenansatzId: wertOderLeer(eintrag ? eintrag.stundenansatz_id : standard?.id),
          festpreisProEinheit: wertOderLeer(eintrag?.festpreis_pro_einheit), angebotGruppe: eintrag?.angebot_gruppe ?? '',
          hinweis: eintrag?.hinweis ?? '', reihenfolge: wertOderLeer(eintrag ? eintrag.reihenfolge : leistungen.length + 1),
          aktiv: eintrag ? (eintrag.aktiv ? '1' : '0') : '1',
        }}
        felder={[
          { name: 'name', label: 'Leistung', typ: 'text', pflicht: true },
          { name: 'einheit', label: 'Einheit', typ: 'text', pflicht: true, halb: true, vorschlaege: EINHEITEN_VORSCHLAG },
          { name: 'turnus', label: 'Turnus', typ: 'select', optionen: TURNUS.map((t) => ({ wert: t.wert, label: t.wert === 'jaehrlich' ? 'Jahr (÷ 12 in der Monatspauschale)' : 'Monat' })), leer: false, halb: true },
          { name: 'preisArt', label: 'Preis', typ: 'select', optionen: PREIS_ARTEN, leer: false },
          { name: 'minutenProEinheit', label: 'Zeit pro Einheit (Min.)', typ: 'zahl', halb: true, pflicht: false,
            hinweis: 'Bei Festpreis: Planzeit für den Soll-/Ist-Vergleich.' },
          { name: 'stundenansatzId', label: (f) => (f.preisArt === 'zeit' ? 'Stundenansatz' : 'Zielansatz (Kalkulation)'), typ: 'select', halb: true,
            optionen: aktiveAnsaetze.map((a) => ({ wert: String(a.id), label: `${a.name} (${formatiereCHF(a.chf_pro_stunde)})` })) },
          { name: 'festpreisProEinheit', label: 'CHF pro Einheit', typ: 'zahl', halb: true, schritt: '0.05', sichtbar: (f) => f.preisArt === 'fix' },
          { name: 'angebotGruppe', label: 'Gruppe im Angebot', typ: 'text', vorschlaege: gruppen,
            hinweis: 'Optional: Leistungen derselben Gruppe erscheinen in der Offerte als eine Zeile.' },
          { name: 'hinweis', label: 'Hinweis', typ: 'text' },
          { name: 'reihenfolge', label: 'Reihenfolge', typ: 'zahl', halb: true, schritt: '1' },
          { name: 'aktiv', label: 'Status', typ: 'select', optionen: STATUS_OPTIONEN, leer: false, halb: true },
        ]}
        vorschau={(f) => {
          const preis = preisProEinheit({
            preis_art: f.preisArt, minuten_pro_einheit: f.minutenProEinheit, festpreis_pro_einheit: f.festpreisProEinheit,
            stundenansatz_id: Number(f.stundenansatzId),
          }, ansaetze);
          return preis == null ? null : `= CHF ${formatiereCHF(preis)} pro ${f.einheit || 'Einheit'}`;
        }}
        onSpeichern={(f) => nachAktion(() => {
          if (f.preisArt === 'zeit' && (f.minutenProEinheit === '' || !f.stundenansatzId)) {
            throw new Error('Zeitbasierte Leistung braucht Zeit pro Einheit und Stundenansatz.');
          }
          return api.preise.leistungen.speichern(eintrag?.id, { ...f, aktiv: f.aktiv === '1' });
        })}
        onLoeschen={eintrag ? () => nachAktion(() => api.preise.leistungen.loeschen(eintrag.id)) : undefined}
        loeschenText={`Leistung «${eintrag?.name}» löschen?`}
        onSchliessen={schliessen}
      />
    );
  }

  function modulFenster(eintrag) {
    return (
      <FormularModal
        titel={eintrag ? 'ABACUS-Modul bearbeiten' : 'Neues ABACUS-Modul'}
        startwerte={{
          name: eintrag?.name ?? '', chfProMonat: wertOderLeer(eintrag?.chf_pro_monat),
          einkaufspreisProMonat: wertOderLeer(eintrag?.einkaufspreis_pro_monat), hinweis: eintrag?.hinweis ?? '',
          reihenfolge: wertOderLeer(eintrag ? eintrag.reihenfolge : module.length + 1), aktiv: eintrag ? (eintrag.aktiv ? '1' : '0') : '1',
        }}
        felder={[
          { name: 'name', label: 'Modul', typ: 'text', pflicht: true },
          { name: 'chfProMonat', label: 'Verkauf CHF/Mt.', typ: 'zahl', pflicht: true, halb: true, schritt: '0.05' },
          { name: 'einkaufspreisProMonat', label: 'Einkauf CHF/Mt.', typ: 'zahl', halb: true, schritt: '0.05', hinweis: 'Optional, für die Lizenzmarge.' },
          { name: 'hinweis', label: 'Hinweis', typ: 'text' },
          { name: 'reihenfolge', label: 'Reihenfolge', typ: 'zahl', halb: true, schritt: '1' },
          { name: 'aktiv', label: 'Status', typ: 'select', optionen: STATUS_OPTIONEN, leer: false, halb: true },
        ]}
        onSpeichern={(f) => nachAktion(() => api.preise.abacusModule.speichern(eintrag?.id, { ...f, aktiv: f.aktiv === '1' }))}
        onLoeschen={eintrag ? () => nachAktion(() => api.preise.abacusModule.loeschen(eintrag.id)) : undefined}
        loeschenText={`ABACUS-Modul «${eintrag?.name}» löschen?`}
        onSchliessen={schliessen}
      />
    );
  }

  function vorlageFenster() {
    return (
      <FormularModal
        titel="Absender & Texte der Offerte"
        breit
        startwerte={{
          firma: firma.firma ?? '', strasse: firma.strasse ?? '', plzOrt: firma.plzOrt ?? '', telefon: firma.telefon ?? '',
          email: firma.email ?? '', mwstNr: firma.mwstNr ?? '', untertitel: firma.untertitel ?? '', slogan: firma.slogan ?? '',
          gueltigTage: wertOderLeer(texte.gueltigTage ?? 30), konditionen: (texte.konditionen || []).join(ZEILENUMBRUCH),
          schlusssatz: texte.schlusssatz ?? '', mailBetreff: texte.mailBetreff ?? '', mailText: texte.mailText ?? '',
        }}
        felder={[
          { name: 'firma', label: 'Firma', typ: 'text', pflicht: true, halb: true },
          { name: 'strasse', label: 'Strasse', typ: 'text', halb: true },
          { name: 'plzOrt', label: 'PLZ/Ort', typ: 'text', halb: true },
          { name: 'telefon', label: 'Telefon', typ: 'text', halb: true },
          { name: 'email', label: 'E-Mail', typ: 'text', halb: true },
          { name: 'mwstNr', label: 'MWST-Nr.', typ: 'text', halb: true },
          { name: 'untertitel', label: 'Untertitel unter «Angebot»', typ: 'text', halb: true },
          { name: 'slogan', label: 'Slogan (Fusszeile)', typ: 'text', halb: true },
          { name: 'gueltigTage', label: 'Gültigkeit neuer Offerten (Tage)', typ: 'zahl', schritt: '1' },
          { name: 'konditionen', label: 'Konditionen (eine pro Zeile)', typ: 'textarea',
            hinweis: 'Die Zeile «Dieses Angebot ist gültig bis …» und ein allfälliger Skonto werden automatisch ergänzt.' },
          { name: 'schlusssatz', label: 'Schlusssatz', typ: 'text' },
          { name: 'mailBetreff', label: 'E-Mail-Betreff', typ: 'text' },
          { name: 'mailText', label: 'E-Mail-Text', typ: 'textarea',
            hinweis: 'Platzhalter: {nummer} {mandant} {ansprechperson} {gueltigBis} {bearbeiter} {firma}' },
        ]}
        onSpeichern={(f) => nachAktion(async () => {
          await api.buero.speichern('firma', {
            firma: f.firma, strasse: f.strasse, plzOrt: f.plzOrt, telefon: f.telefon, email: f.email,
            mwstNr: f.mwstNr, untertitel: f.untertitel, slogan: f.slogan,
          });
          await api.buero.speichern('offerte', {
            ...texte, gueltigTage: Number(f.gueltigTage) || 30,
            konditionen: f.konditionen.split(ZEILENUMBRUCH).map((z) => z.trim()).filter(Boolean),
            schlusssatz: f.schlusssatz, mailBetreff: f.mailBetreff, mailText: f.mailText,
          });
        })}
        onSchliessen={schliessen}
      />
    );
  }

  const bearbeiten = (art, eintrag) => <button type="button" className="btn-klein" onClick={() => setOffen({ art, eintrag })}>Bearbeiten</button>;
  const status = (e) => (e.aktiv ? 'Aktiv' : <span className="tag-inaktiv">INAKTIV</span>);

  return (
    <div className="preise-seite">
      <div className="preise-abschnitt-kopf">
        <h1 className="seiten-titel">Preise &amp; Katalog</h1>
        <button type="button" className="btn-klein" onClick={() => setOffen({ art: 'vorlage', eintrag: null })}>Absender &amp; Texte der Offerte</button>
      </div>
      <p className="seiten-untertitel">Grundlage für Offerten, Pauschalen der Mandanten und die Rentabilität. Beträge exkl. MWST.</p>
      {fehler && (
        <div className="hinweis-fehler">
          Fehler beim Laden: {fehler}
          {/relation|does not exist|schema cache/i.test(fehler) && ' – ist die Schema-Erweiterung (supabase/schema.sql) schon ausgeführt?'}
        </div>
      )}

      <div className="preise-abschnitt-kopf">
        <h2 className="abschnitt-titel">Stundenansätze</h2>
        <button type="button" className="btn-klein" onClick={() => setOffen({ art: 'ansatz', eintrag: null })}>+ Neuer Ansatz</button>
      </div>
      <div className="karte preise-karte-schmal">
        <table className="tabelle">
          <thead><tr><th>Name</th><th className="zahl">CHF/Std.</th><th>Standard</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {ansaetze.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td className="zahl">{formatiereCHF(a.chf_pro_stunde)}</td>
                <td>{a.ist_standard ? '✓ Standard' : ''}</td>
                <td>{status(a)}</td>
                <td className="spalte-aktionen">{bearbeiten('ansatz', a)}</td>
              </tr>
            ))}
            {ansaetze.length === 0 && <tr><td colSpan={5} className="leer-hinweis">Noch keine Stundenansätze erfasst.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="preise-abschnitt-kopf">
        <h2 className="abschnitt-titel">Leistungskatalog</h2>
        <button type="button" className="btn-klein" onClick={() => setOffen({ art: 'leistung', eintrag: null })}>+ Neue Leistung</button>
      </div>
      <div className="karte">
        <table className="tabelle">
          <thead>
            <tr>
              <th>Leistung</th><th>Einheit</th><th>Turnus</th><th className="zahl">Zeit/Einh.</th><th>Ansatz</th>
              <th className="zahl">CHF/Einh.</th><th>Gruppe im Angebot</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {leistungen.map((l) => (
              <tr key={l.id} title={l.hinweis || undefined}>
                <td>{l.name}</td>
                <td>{l.einheit}</td>
                <td>{turnusLabel(l.turnus)}</td>
                <td className="zahl">
                  {l.minuten_pro_einheit == null
                    ? <span className="preise-fehlt" title="Planzeit fehlt – nötig für den Soll-/Ist-Vergleich">fehlt</span>
                    : formatiereMinuten(Number(l.minuten_pro_einheit))}
                </td>
                <td>{l.preis_art === 'fix' ? `Festpreis · Ziel ${ansatzName(l.stundenansatz_id)}` : ansatzName(l.stundenansatz_id)}</td>
                <td className="zahl">{formatiereCHF(preisProEinheit(l, ansaetze))}</td>
                <td className="preise-gruppe">{l.angebot_gruppe || ''}</td>
                <td>{status(l)}</td>
                <td className="spalte-aktionen">{bearbeiten('leistung', l)}</td>
              </tr>
            ))}
            {leistungen.length === 0 && <tr><td colSpan={9} className="leer-hinweis">Noch keine Leistungen erfasst.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="preise-abschnitt-kopf">
        <h2 className="abschnitt-titel">ABACUS-Module</h2>
        <button type="button" className="btn-klein" onClick={() => setOffen({ art: 'modul', eintrag: null })}>+ Neues Modul</button>
      </div>
      <div className="karte preise-karte-schmal">
        <table className="tabelle">
          <thead><tr><th>Modul</th><th className="zahl">Verkauf CHF/Mt.</th><th className="zahl">Einkauf</th><th className="zahl">Marge</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {module.map((m) => (
              <tr key={m.id} title={m.hinweis || undefined}>
                <td>{m.name}</td>
                <td className="zahl">{formatiereCHF(m.chf_pro_monat)}</td>
                <td className="zahl">{m.einkaufspreis_pro_monat == null ? '–' : formatiereCHF(m.einkaufspreis_pro_monat)}</td>
                <td className="zahl">{m.einkaufspreis_pro_monat == null ? '–' : formatiereCHF(m.chf_pro_monat - m.einkaufspreis_pro_monat)}</td>
                <td>{status(m)}</td>
                <td className="spalte-aktionen">{bearbeiten('modul', m)}</td>
              </tr>
            ))}
            {module.length === 0 && <tr><td colSpan={6} className="leer-hinweis">Noch keine Module erfasst.</td></tr>}
          </tbody>
        </table>
      </div>

      {offen?.art === 'ansatz' && ansatzFenster(offen.eintrag)}
      {offen?.art === 'leistung' && leistungFenster(offen.eintrag)}
      {offen?.art === 'modul' && modulFenster(offen.eintrag)}
      {offen?.art === 'vorlage' && vorlageFenster()}
    </div>
  );
}
