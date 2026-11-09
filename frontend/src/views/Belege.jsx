import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api.js';
import FormularModal from '../components/FormularModal.jsx';
import BelegAnsicht from '../components/BelegAnsicht.jsx';
import { useAblageGrund, useMandanten } from '../hooks.js';
import { formatiereDatum, heutigesDatumISO } from '../format.js';
import { chf } from '../lib/offerte.js';
import { belegStatus } from '../lib/liquiditaet.js';
import { buchhaltungsMandant, belegOrdner, belegDateiname } from '../lib/belege.js';
import { unterstuetzt, grundOrdnerHolen, dateiAblegen, dateiLesen } from '../lib/ablageOrdner.js';

const TEXTE = {
  kreditor: { titel: 'Kreditoren', partner: 'Kreditor', hinweis: 'Eingangsrechnungen – was du bezahlen musst.', drop: 'Kreditorenrechnungen' },
  debitor: { titel: 'Debitoren', partner: 'Debitor', hinweis: 'Ausgangsrechnungen – was dir Kunden bezahlen.', drop: 'Debitorenrechnungen' },
};
const FILTER = [{ wert: 'offen', label: 'Offen' }, { wert: 'bezahlt', label: 'Bezahlt' }, { wert: 'alle', label: 'Alle' }];
const STATUS_TEXT = { offen: 'offen', ueberfaellig: 'überfällig', bezahlt: 'bezahlt' };

// Modul Buchhaltung › Kreditoren bzw. Debitoren: Rechnungen hineinziehen, die KI liest die
// Angaben aus, der Beleg wird im OneDrive-Ordner abgelegt; hier steht nur die Liste.
export default function Belege({ art }) {
  const t = TEXTE[art];
  const [belege, setBelege] = useState(null);
  const [einstellungen, setEinstellungen] = useState({});
  const [firma, setFirma] = useState({});
  const [fehler, setFehler] = useState(null);
  const [meldung, setMeldung] = useState(null);
  const [filter, setFilter] = useState('offen');
  const [suche, setSuche] = useState('');
  const [ziehen, setZiehen] = useState(false);
  const [warteschlange, setWarteschlange] = useState([]); // noch zu erfassende Dateien
  const [aktuell, setAktuell] = useState(null); // { file, angaben, liest, kiFehler } oder { beleg }
  const [ablageDialog, setAblageDialog] = useState(false);
  const [verbunden, setVerbunden] = useState(false);
  const dateiRef = useRef(null);
  const mandanten = useMandanten();
  const grund = useAblageGrund();
  const heute = heutigesDatumISO();

  const laden = useCallback(() => {
    api.belege.liste(art).then((l) => { setBelege(l); setFehler(null); }).catch((e) => { setBelege([]); setFehler(e.message); });
  }, [art]);
  useEffect(() => {
    laden();
    api.buero.lesen('buchhaltung').then(setEinstellungen).catch(() => {});
    api.buero.lesen('firma').then(setFirma).catch(() => {});
    grundOrdnerHolen().then((h) => setVerbunden(!!h));
  }, [laden]);

  // Naechste Datei aus der Warteschlange auslesen lassen.
  useEffect(() => {
    if (aktuell || !warteschlange.length) return;
    const [file, ...rest] = warteschlange;
    const zeitgeber = setTimeout(() => {
      setWarteschlange(rest);
      setAktuell({ file, angaben: null, liest: true });
      api.belege.auslesen(file, art, firma.firma)
        .then((angaben) => setAktuell({ file, angaben, liest: false }))
        .catch((err) => setAktuell({ file, angaben: null, liest: false, kiFehler: err.message }));
    }, 0);
    return () => clearTimeout(zeitgeber);
  }, [warteschlange, aktuell, art, firma.firma]);

  const mandant = buchhaltungsMandant(einstellungen, mandanten);
  const ordnerBeispiel = belegOrdner({ art, datum: heute }, einstellungen, mandant, grund);
  const tabelleFehlt = fehler && /schema cache|does not exist|relation/i.test(fehler);

  function dateienAnnehmen(files) {
    const liste = [...files].filter((f) => f.size > 0);
    if (!liste.length) return;
    setMeldung(null);
    setWarteschlange((w) => [...w, ...liste]);
  }

  async function oeffnen(b) {
    setFehler(null);
    const fenster = window.open('', '_blank');
    try {
      const file = await dateiLesen(b.ablage_pfad);
      const url = URL.createObjectURL(file);
      if (fenster) fenster.location.href = url; else window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      fenster?.close();
      setFehler(err.message);
    }
  }

  async function bezahltUmschalten(b) {
    try {
      await api.belege.bezahlt(b.id, b.bezahlt_am ? null : heute);
      laden();
    } catch (err) { setFehler(err.message); }
  }

  const sichtbar = (belege ?? []).filter((b) => {
    const s = belegStatus(b, heute);
    if (filter === 'offen' && s === 'bezahlt') return false;
    if (filter === 'bezahlt' && s !== 'bezahlt') return false;
    const q = suche.trim().toLowerCase();
    return !q || `${b.partner} ${b.rechnungsnummer ?? ''}`.toLowerCase().includes(q);
  });
  const offenSumme = (belege ?? []).filter((b) => !b.bezahlt_am && (b.waehrung || 'CHF') === 'CHF').reduce((s, b) => s + Number(b.betrag || 0), 0);
  const ueberfaelligAnzahl = (belege ?? []).filter((b) => belegStatus(b, heute) === 'ueberfaellig').length;

  // Formular zum Erfassen/Bearbeiten (aus KI-Angaben, von Hand oder bestehender Beleg).
  function formular() {
    const bestehend = aktuell.beleg ?? null;
    const a = aktuell.angaben ?? {};
    const start = bestehend ? {
      partner: bestehend.partner, partnerAdresse: bestehend.partner_adresse ?? '', iban: bestehend.iban ?? '', zahlungsreferenz: bestehend.zahlungsreferenz ?? '',
      rechnungsnummer: bestehend.rechnungsnummer ?? '', rechnungsdatum: bestehend.rechnungsdatum ?? '',
      faelligkeit: bestehend.faelligkeit ?? '', betrag: bestehend.betrag ?? '', waehrung: bestehend.waehrung ?? 'CHF',
      bezahltAm: bestehend.bezahlt_am ?? '', notiz: bestehend.notiz ?? '',
    } : {
      partner: a.partner ?? '', partnerAdresse: a.partner_adresse ?? '', iban: a.iban ?? '', zahlungsreferenz: a.referenz ?? '',
      rechnungsnummer: a.rechnungsnummer ?? '', rechnungsdatum: a.rechnungsdatum ?? '',
      faelligkeit: a.faelligkeit ?? '', betrag: a.betrag ?? '', waehrung: a.waehrung || 'CHF', bezahltAm: '', notiz: '',
    };
    const file = aktuell.file ?? null;
    return (
      <FormularModal
        titel={bestehend ? `${t.partner}-Beleg bearbeiten` : file ? `Beleg erfassen · ${file.name}` : `${t.partner}-Beleg von Hand erfassen`}
        startwerte={start}
        speichernText={file ? 'Speichern & ablegen' : 'Speichern'}
        breit
        seitenansicht={<BelegAnsicht file={file} pfad={bestehend?.ablage_pfad ?? null} />}
        felder={[
          { name: 'partner', label: t.partner, typ: 'text', pflicht: true },
          { name: 'partnerAdresse', label: 'Adresse', typ: 'text', platzhalter: 'Strasse, PLZ Ort' },
          { name: 'rechnungsnummer', label: 'Rechnungsnummer', typ: 'text', halb: true },
          { name: 'rechnungsdatum', label: 'Rechnungsdatum', typ: 'datum', halb: true },
          { name: 'faelligkeit', label: 'Fällig am', typ: 'datum', halb: true },
          { name: 'betrag', label: 'Betrag inkl. MWST', typ: 'zahl', schritt: '0.05', halb: true },
          { name: 'waehrung', label: 'Währung', typ: 'text', halb: true },
          { name: 'iban', label: art === 'kreditor' ? 'IBAN / QR-IBAN des Kreditors' : 'IBAN (Zahlungskonto)', typ: 'text', halb: true },
          { name: 'zahlungsreferenz', label: 'Referenz / Mitteilung', typ: 'text', halb: true },
          { name: 'bezahltAm', label: 'Bezahlt am', typ: 'datum', halb: true },
          { name: 'notiz', label: 'Notiz', typ: 'textarea' },
        ]}
        vorschau={(f) => {
          if (aktuell.kiFehler) return `Automatisch auslesen ging nicht (${aktuell.kiFehler}) – bitte von Hand ergänzen.`;
          if (!file) return bestehend?.ablage_pfad ? `Beleg: ${bestehend.ablage_pfad}` : '';
          const ordner = belegOrdner({ art, datum: f.rechnungsdatum }, einstellungen, mandant, grund);
          if (!unterstuetzt()) return 'Dieser Browser kann nicht direkt in OneDrive ablegen – bitte Edge oder Chrome am PC verwenden.';
          if (!ordner) return `Kein Ablage-Ordner: beim Mandanten «${mandant?.name ?? 'EST Controlling'}» den Ordner hinterlegen.`;
          return `Ablage: ${[...ordner, belegDateiname(f, file.name)].join(' › ')}${aktuell.angaben ? ' · Angaben von der KI ausgelesen – bitte prüfen.' : ''}`;
        }}
        onSpeichern={async (f) => {
          let ablagePfad;
          let dateiname;
          if (file) {
            const ordner = belegOrdner({ art, datum: f.rechnungsdatum }, einstellungen, mandant, grund);
            if (!unterstuetzt()) throw new Error('Direkt ablegen geht nur mit Edge oder Chrome am PC.');
            if (!ordner) throw new Error(`Beim Mandanten «${mandant?.name ?? 'EST Controlling'}» ist kein Ablage-Ordner hinterlegt.`);
            dateiname = belegDateiname(f, file.name);
            ablagePfad = await dateiAblegen(file, dateiname, ordner);
          }
          await api.belege.speichern(bestehend?.id ?? null, { ...f, art, ...(file ? { dateiname, ablagePfad } : {}) });
          setAktuell(null);
          setVerbunden(true);
          setMeldung(file ? `Beleg abgelegt: ${ablagePfad}` : 'Gespeichert.');
          laden();
        }}
        onLoeschen={bestehend ? async () => {
          await api.belege.loeschen(bestehend.id);
          setAktuell(null);
          laden();
        } : undefined}
        loeschenText="Beleg aus der Liste löschen? Die Datei in OneDrive bleibt."
        onSchliessen={() => setAktuell(null)}
      />
    );
  }

  return (
    <div>
      <div className="cockpit-kopfzeile">
        <h1 className="seiten-titel">{t.titel}</h1>
        <span className="cockpit-kopf-hinweis">{t.hinweis}</span>
        <span className="kopfzeile-aktionen">
          <button type="button" className="btn" onClick={() => setAktuell({ file: null, angaben: null })} disabled={tabelleFehlt}>+ Von Hand</button>
        </span>
      </div>
      {tabelleFehlt && <div className="hinweis-fehler">Buchhaltung noch nicht eingerichtet – bitte zuerst <code>supabase/buchhaltung-v7.sql</code> in Supabase ausführen.</div>}

      <div
        className={`beleg-drop ${ziehen ? 'aktiv' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setZiehen(true); }}
        onDragLeave={() => setZiehen(false)}
        onDrop={(e) => { e.preventDefault(); setZiehen(false); dateienAnnehmen(e.dataTransfer.files); }}
        onClick={() => dateiRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') dateiRef.current?.click(); }}
      >
        <div className="beleg-drop-titel">{t.drop} hierher ziehen</div>
        <div className="beleg-drop-text">
          PDF oder Bild · die KI liest Datum, Nummer, {t.partner}, Fälligkeit und Betrag aus · abgelegt in{' '}
          {ordnerBeispiel ? <code>{ordnerBeispiel.join(' › ')}</code> : <strong>– kein Ablage-Ordner –</strong>}
          {' '}<button type="button" className="link-knopf" onClick={(e) => { e.stopPropagation(); setAblageDialog(true); }}>ändern</button>
        </div>
        {!verbunden && unterstuetzt() && <div className="beleg-drop-text">OneDrive ist auf diesem Gerät noch nicht verbunden – beim ersten Ablegen fragt der Browser nach dem Grundordner (<Link to="/einstellungen" onClick={(e) => e.stopPropagation()}>Einstellungen › Ablage</Link>).</div>}
        {(warteschlange.length > 0 || aktuell?.liest) && <div className="beleg-drop-status">Liest {aktuell?.file?.name ?? ''} aus…{warteschlange.length ? ` (noch ${warteschlange.length} in der Warteschlange)` : ''}</div>}
        <input ref={dateiRef} type="file" accept=".pdf,image/*" multiple hidden onChange={(e) => { dateienAnnehmen(e.target.files); e.target.value = ''; }} />
      </div>

      {meldung && <div className="hinweis-erfolg">{meldung}</div>}
      {fehler && !tabelleFehlt && <div className="hinweis-fehler">{fehler}</div>}

      <div className="filter-leiste">
        <input type="search" placeholder={`Suche ${t.partner} oder Nr.`} value={suche} onChange={(e) => setSuche(e.target.value)} />
        <span className="mandanten-filter">
          {FILTER.map((fi) => (
            <button key={fi.wert} type="button" className={`mandanten-filter-knopf ${filter === fi.wert ? 'aktiv' : ''}`} onClick={() => setFilter(fi.wert)}>{fi.label}</button>
          ))}
        </span>
        <span className="beleg-summe">
          Offen: <strong>{chf(offenSumme)}</strong>
          {ueberfaelligAnzahl > 0 && <span className="text-ueberfaellig"> · {ueberfaelligAnzahl} überfällig</span>}
        </span>
      </div>

      <div className="karte">
        <table className="tabelle">
          <thead>
            <tr>
              <th>Rechnungsdatum</th><th>Rechnungs-Nr.</th><th>{t.partner}</th><th>Fällig</th>
              <th className="zahl">Betrag</th><th>Status</th><th>Beleg</th><th></th>
            </tr>
          </thead>
          <tbody>
            {sichtbar.map((b) => {
              const s = belegStatus(b, heute);
              return (
                <tr key={b.id} className="klickbar" onClick={() => setAktuell({ beleg: b })}>
                  <td>{b.rechnungsdatum ? formatiereDatum(b.rechnungsdatum) : '–'}</td>
                  <td>{b.rechnungsnummer || '–'}</td>
                  <td><strong>{b.partner}</strong></td>
                  <td className={s === 'ueberfaellig' ? 'text-ueberfaellig' : ''}>{b.faelligkeit ? formatiereDatum(b.faelligkeit) : '–'}</td>
                  <td className="zahl">{b.betrag != null ? `${(b.waehrung || 'CHF') !== 'CHF' ? `${b.waehrung} ` : ''}${chf(b.betrag)}` : '–'}</td>
                  <td><span className={`beleg-status beleg-status-${s}`}>{STATUS_TEXT[s]}{s === 'bezahlt' && b.bezahlt_am ? ` ${formatiereDatum(b.bezahlt_am).slice(0, 6)}` : ''}</span></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {b.ablage_pfad ? <button type="button" className="link-knopf" title={b.ablage_pfad} onClick={() => oeffnen(b)}>📄 öffnen</button> : <span className="text-gedaempft">–</span>}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="btn-klein" onClick={() => bezahltUmschalten(b)}>{b.bezahlt_am ? 'offen' : '✓ bezahlt'}</button>
                  </td>
                </tr>
              );
            })}
            {belege && sichtbar.length === 0 && !tabelleFehlt && <tr><td colSpan={8} className="leer-hinweis">Keine Belege.</td></tr>}
          </tbody>
        </table>
      </div>

      {aktuell && !aktuell.liest && formular()}

      {ablageDialog && (
        <FormularModal
          titel="Ablage der Belege"
          startwerte={{
            mandantId: String(mandant?.id ?? ''), ordnerKreditoren: einstellungen.ordnerKreditoren ?? 'Kreditoren',
            ordnerDebitoren: einstellungen.ordnerDebitoren ?? 'Debitoren', proJahr: einstellungen.proJahr !== false,
          }}
          felder={[
            { name: 'mandantId', label: 'Ordner von Mandant', typ: 'select', leer: '– wählen –', optionen: mandanten.map((m) => ({ wert: String(m.id), label: m.name })) },
            { name: 'ordnerKreditoren', label: 'Unterordner Kreditoren', typ: 'text', halb: true },
            { name: 'ordnerDebitoren', label: 'Unterordner Debitoren', typ: 'text', halb: true },
            { name: 'proJahr', label: 'Pro Jahr ein Unterordner (z.B. 2026)', typ: 'checkbox' },
          ]}
          vorschau={(f) => {
            const m = mandanten.find((x) => String(x.id) === f.mandantId);
            const o = belegOrdner({ art, datum: heute }, f, m, grund);
            return o ? `Beispiel: ${o.join(' › ')}` : 'Dieser Mandant hat keinen Ablage-Ordner («Mandant bearbeiten» › Ordner wählen).';
          }}
          onSpeichern={async (f) => {
            const neu = { ...(await api.buero.lesen('buchhaltung')), mandantId: f.mandantId ? Number(f.mandantId) : null, ordnerKreditoren: f.ordnerKreditoren.trim() || 'Kreditoren', ordnerDebitoren: f.ordnerDebitoren.trim() || 'Debitoren', proJahr: !!f.proJahr };
            await api.buero.speichern('buchhaltung', neu);
            setEinstellungen(neu);
            setAblageDialog(false);
          }}
          onSchliessen={() => setAblageDialog(false)}
        />
      )}
    </div>
  );
}
