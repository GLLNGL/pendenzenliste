// Datenzugriff ueber Supabase statt eines eigenen Express-Servers (Migration weg vom
// Buero-PC/Tailscale, siehe Migrationsplan). Absichtlich mit DERSELBEN Methodenform wie zuvor
// (api.pendenzen.liste(...) usw.), damit Views/Komponenten unveraendert bleiben koennen --
// nur hier drin aendert sich, WIE die Daten geholt werden.
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './lib/supabaseClient.js';
import { STATUS_WERTE, OFFENE_STATUS, PRIORITAETEN, RHYTHMEN, FAELLIGKEIT_TYPEN, BLOECKE, MWST_PERIODEN, ZAHLUNGSLAUF_RHYTHMEN } from './constants.js';
import { naechstePendenzen, faelligeVorkommen, heutigesDatumUTC } from './lib/recurrence.js';
import { REGEL_TYPEN } from './lib/regelVorlagen.js';
import { heutigesDatumISO, datumPlusTage } from './format.js';
import { baueICS, dateinameFuer } from './lib/ics.js';
import { laufendeMinuten, ansatzFuer } from './lib/zeit.js';

// btoa() kann nur Latin1 -- Umlaute/Sonderzeichen in Titel/Beschreibung brauchen den Umweg
// ueber UTF-8-Bytes, sonst wirft btoa bei manchen Zeichen einen Fehler.
function utf8ZuBase64(text) {
  return btoa(unescape(encodeURIComponent(text)));
}

// Der tatsaechliche Funktionsname im Supabase-Dashboard ist "clever-processor" (von Supabase
// zufaellig vergeben, als "send-mail" umbenannt wurde nur der Anzeigename geaendert, nicht der
// Aufruf-Pfad) -- functions.invoke() braucht den echten Pfad, nicht den Anzeigenamen.
// Fehlertext einer Edge Function lesen ({ fehler: '...' }); Text statt json(), weil der
// Antwortkoerper sonst bei manchen Antworten nicht gelesen werden kann.
async function fehlerKoerperLesen(error) {
  try {
    const roh = await error.context.text();
    return JSON.parse(roh);
  } catch {
    return null;
  }
}

async function sendMailAufrufen(body) {
  const { data, error } = await supabase.functions.invoke('clever-processor', { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const fehlerKoerper = await fehlerKoerperLesen(error);
      throw new Error(fehlerKoerper?.fehler || error.message);
    }
    throw new Error(error.message);
  }
  return data;
}

// --------------------------------------------------------------------------------------------
// Dateien (v7): Supabase-Speicher, Bucket "dateien" (nicht oeffentlich), plus Tabelle dateien.
// --------------------------------------------------------------------------------------------
const BUCKET = 'dateien';

// Speicherschluessel ohne Umlaute/Sonderzeichen (der Originalname steht in der Tabelle).
function sichererDateiname(name) {
  return String(name || 'datei').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120) || 'datei';
}

function blobZuBase64(blob) {
  return new Promise((resolve, reject) => {
    const leser = new FileReader();
    leser.onload = () => resolve(String(leser.result).split(',')[1] ?? '');
    leser.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    leser.readAsDataURL(blob);
  });
}

async function dateiBlob(datei) {
  const { data, error } = await supabase.storage.from(BUCKET).download(datei.speicherpfad);
  if (error) throw new Error(`«${datei.dateiname}» konnte nicht geladen werden: ${error.message}`);
  return data;
}

async function dateienDerPendenzEntfernen(pendenzId) {
  // Fehlt die Tabelle noch (SQL nicht ausgefuehrt), still weiter.
  const { data: kinder } = await supabase.from('pendenzen').select('id').eq('uebergeordnete_pendenz_id', pendenzId);
  const ids = [pendenzId, ...(kinder ?? []).map((k) => k.id)];
  const { data, error } = await supabase.from('dateien').select('speicherpfad').in('pendenz_id', ids);
  if (error || !data?.length) return;
  await supabase.storage.from(BUCKET).remove(data.map((d) => d.speicherpfad));
}

// Verletzte Datenbank-Regeln (Check-Constraints in supabase/schema.sql) als verstaendliche
// Meldung statt der rohen Postgres-Fehlermeldung anzeigen.
const CONSTRAINT_MELDUNGEN = {
  pendenzen_warten_auf_pflicht: 'Status «Warten auf» braucht eine Person und ein Nachfassdatum.',
  pendenzen_prioritaet_check: 'Ungültige Priorität (erlaubt: A, B, C).',
  pendenzen_status_check: 'Ungültiger Status.',
  pendenzen_aufwand_minuten_check: 'Ungültiger Aufwand.',
  pendenzen_block_check: 'Ungültiger Block.',
  idx_mandanten_kunden_nr: 'Diese Kunden-Nr. ist bereits vergeben.',
  idx_stundenansaetze_ein_standard: 'Es kann nur einen Standardansatz geben.',
  stundenansaetze_name_key: 'Ein Ansatz mit diesem Namen existiert bereits.',
  leistungen_name_key: 'Eine Leistung mit diesem Namen existiert bereits.',
  abacus_module_name_key: 'Ein Modul mit diesem Namen existiert bereits.',
  leistungen_zeit_pflicht: 'Zeitbasierte Leistung braucht Zeit pro Einheit und Stundenansatz.',
  leistungen_fix_pflicht: 'Festpreis-Leistung braucht einen Preis pro Einheit.',
  leistungen_stundenansatz_id_fkey: 'Dieser Ansatz wird noch von Leistungen verwendet – stattdessen auf inaktiv setzen.',
  mandant_pauschalen_leistung_id_fkey: 'Diese Leistung ist noch in Pauschalen von Mandanten hinterlegt – stattdessen auf inaktiv setzen.',
  mandant_pauschalen_abacus_modul_id_fkey: 'Dieses Modul ist noch in Pauschalen von Mandanten hinterlegt – stattdessen auf inaktiv setzen.',
  mandant_pauschalen_zeitraum: '«Gültig bis» liegt vor «Gültig ab».',
  mandant_pauschalen_eine_position: 'Bitte genau eine Leistung oder ein ABACUS-Modul wählen.',
  idx_zeiteintraege_ein_timer: 'Es läuft bereits ein Timer – bitte zuerst stoppen.',
  zeiteintraege_intern_ohne_mandant: 'Interne Zeit hat keinen Mandanten, Mandanten-Zeit ist Pauschale oder Extra.',
  zeiteintraege_mandant_id_fkey: 'Für diesen Mandanten ist Zeit erfasst – er kann nicht gelöscht werden (stattdessen inaktiv setzen).',
};

// Leerer Text -> null, sonst getrimmt.
function textOderNull(wert) {
  if (wert == null) return null;
  const t = String(wert).trim();
  return t === '' ? null : t;
}

// Adress- und Statusfelder der Mandanten (v7) -- nur Felder uebernehmen, die im Aufruf vorkommen.
function mandantAdresse(daten) {
  const patch = {};
  for (const [feld, spalte] of [['kundenNr', 'kunden_nr'], ['ansprechperson', 'ansprechperson'], ['strasse', 'strasse'],
    ['plz', 'plz'], ['ort', 'ort'], ['telefon', 'telefon'], ['ablagePfad', 'ablage_pfad'], ['ablageLink', 'ablage_link'],
    ['ablageOrdner', 'ablage_ordner']]) {
    if (daten[feld] !== undefined) patch[spalte] = textOderNull(daten[feld]);
  }
  if (daten.potenziell !== undefined) patch.potenziell = !!daten.potenziell;
  return patch;
}

// Einfache Tabellen (Preise) -- Liste, Speichern (neu/aendern), Loeschen.
function tabelle(name, { sortierung = [['name', true]], zuZeile }) {
  return {
    liste: async () => {
      let q = supabase.from(name).select('*');
      for (const [spalte, aufsteigend] of sortierung) q = q.order(spalte, { ascending: aufsteigend, nullsFirst: false });
      const { data, error } = await q;
      pruefeFehler(error);
      return data;
    },
    speichern: async (id, daten) => {
      const zeile = zuZeile(daten);
      const q = id ? supabase.from(name).update(zeile).eq('id', id) : supabase.from(name).insert(zeile);
      const { data, error } = await q.select().single();
      pruefeFehler(error);
      return data;
    },
    loeschen: async (id) => {
      const { error } = await supabase.from(name).delete().eq('id', id);
      pruefeFehler(error);
    },
  };
}

// Es gibt genau einen Standardansatz: wird ein anderer zum Standard, verliert der bisherige
// die Markierung (zuerst, sonst verletzt das Speichern den eindeutigen Index).
function standardansatzUmschalten(t) {
  return {
    ...t,
    speichern: async (id, daten) => {
      if (daten.istStandard) {
        let q = supabase.from('stundenansaetze').update({ ist_standard: false }).eq('ist_standard', true);
        if (id) q = q.neq('id', id);
        const { error } = await q;
        pruefeFehler(error);
      }
      return t.speichern(id, daten);
    },
  };
}

// Verrechnete Zeit (in einem Detailrapport) bleibt unveraendert, bis der Rapport storniert wird.
async function verrechnetPruefen(id) {
  const { data } = await supabase.from('zeiteintraege').select('rapport_id, rapporte(nummer)').eq('id', id).maybeSingle();
  if (data?.rapport_id) {
    throw new Error(`Diese Zeit ist im Rapport ${data.rapporte?.nummer ?? ''} verrechnet – zum Ändern zuerst den Rapport stornieren.`);
  }
}

function pflichtText(wert, meldung) {
  const t = textOderNull(wert);
  if (!t) throw new Error(meldung);
  return t;
}

function nichtNegativ(wert, meldung) {
  const z = zahlOderNull(wert);
  if (z != null && (Number.isNaN(z) || z < 0)) throw new Error(meldung);
  return z;
}

function pruefeFehler(error) {
  if (!error) return;
  const treffer = Object.keys(CONSTRAINT_MELDUNGEN).find((name) => error.message?.includes(name));
  throw new Error(treffer ? CONSTRAINT_MELDUNGEN[treffer] : error.message);
}

// Leere Formularwerte ('' oder undefined) als null speichern, Zahlen als Zahl.
function zahlOderNull(wert) {
  return wert === '' || wert == null ? null : Number(wert);
}

function pruefeWartenAuf(status, person, nachfassdatum) {
  if (status === 'Warten auf' && (!person || !String(person).trim() || !nachfassdatum)) {
    throw new Error('Status «Warten auf» braucht eine Person und ein Nachfassdatum.');
  }
}

// PostgREST-".or(...)"-Syntax verwendet Komma/Klammern als Trenner -- in freiem Suchtext
// (z.B. "Rechnung, Q3") muessen diese Zeichen escaped werden, sonst wird die Filter-Syntax
// durch Nutzereingaben verfaelscht.
function escapeOrWert(text) {
  return String(text).replace(/[,()]/g, '\\$&');
}

async function aktuelleMitarbeiterId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('mitarbeitende').select('id').eq('auth_user_id', user.id).maybeSingle();
  return data?.id ?? null;
}

const PRIORITAET_RANG = { A: 0, B: 1, C: 2 };

function sortiereListe(liste, sort) {
  if (sort !== 'prioritaet') return liste;
  return [...liste].sort((a, b) => {
    const rangDiff = PRIORITAET_RANG[a.prioritaet] - PRIORITAET_RANG[b.prioritaet];
    if (rangDiff !== 0) return rangDiff;
    return a.faelligkeit < b.faelligkeit ? -1 : a.faelligkeit > b.faelligkeit ? 1 : 0;
  });
}

async function pendenzenListe(query = {}) {
  let q = supabase.from('pendenzen_angereichert').select('*');
  // Eingang-Notizen (siehe api.pendenzen.eingang) sind hier immer ausgeblendet -- sie tauchen
  // erst auf, wenn sie eingeplant wurden (geplant = true, automatisch beim Speichern im vollen
  // Bearbeiten-Fenster).
  q = q.eq('geplant', true);

  if (query.status) {
    const werte = String(query.status).split(',').filter((s) => STATUS_WERTE.includes(s));
    if (werte.length) q = q.in('status', werte);
  }
  if (query.prioritaet) {
    const werte = String(query.prioritaet).split(',').filter((p) => PRIORITAETEN.includes(p));
    if (werte.length) q = q.in('prioritaet', werte);
  }
  if (query.block) {
    const werte = String(query.block).split(',').filter((b) => BLOECKE.includes(b));
    if (werte.length) q = q.in('block', werte);
  }
  if (query.mandantId === 'keiner') q = q.is('mandant_id', null);
  else if (query.mandantId) q = q.eq('mandant_id', Number(query.mandantId));
  if (query.von) q = q.gte('faelligkeit', query.von);
  if (query.bis) q = q.lte('faelligkeit', query.bis);
  if (query.erledigtVon) q = q.gte('erledigt_am', query.erledigtVon);
  if (query.erledigtBis) q = q.lte('erledigt_am', query.erledigtBis);
  if (query.q) q = q.or(`titel.ilike.%${escapeOrWert(query.q)}%,beschreibung.ilike.%${escapeOrWert(query.q)}%`);
  if (query.uebergeordneteId) q = q.eq('uebergeordnete_pendenz_id', Number(query.uebergeordneteId));
  if (query.nurHauptaufgaben === '1') q = q.is('uebergeordnete_pendenz_id', null);

  const sort = query.sort || 'faelligkeit_asc';
  if (sort === 'faelligkeit_desc') q = q.order('faelligkeit', { ascending: false });
  else if (sort === 'erstellt_am_desc') q = q.order('erstellt_am', { ascending: false });
  else if (sort === 'erledigt_am_desc') q = q.order('erledigt_am', { ascending: false });
  else q = q.order('faelligkeit', { ascending: true }); // Standard + Basis fuer "prioritaet"-Sortierung

  const { data, error } = await q;
  pruefeFehler(error);
  return sortiereListe(data, sort);
}

function pendenzPayloadValidieren(payload, { neuer }) {
  if (neuer && (!payload.titel || !String(payload.titel).trim())) throw new Error('Nächster Schritt ist erforderlich');
  if (payload.aufwandMinuten != null && payload.aufwandMinuten !== '' && !(Number(payload.aufwandMinuten) > 0 && Number(payload.aufwandMinuten) <= 6000)) {
    throw new Error('Ungültiger Aufwand');
  }
  if (payload.block !== undefined && payload.block !== null && !BLOECKE.includes(payload.block)) throw new Error('Ungültiger Block');
}

// Zusatzfelder einer Wiederkehr-Regel (Etappe 4) -- nur Felder uebernehmen, die im Aufruf
// vorkommen.
function regelZusatzfelder(daten) {
  const patch = {};
  if (daten.typ !== undefined) {
    if (!REGEL_TYPEN.includes(daten.typ)) throw new Error('Ungültiger Typ');
    patch.typ = daten.typ;
  }
  if (daten.block !== undefined) {
    if (!BLOECKE.includes(daten.block)) throw new Error('Ungültiger Block');
    patch.block = daten.block;
  }
  if (daten.vorlaufEinheit !== undefined) patch.vorlauf_einheit = daten.vorlaufEinheit === 'arbeitstage' ? 'arbeitstage' : 'tage';
  if (daten.checkliste !== undefined) patch.checkliste = (daten.checkliste || []).map((s) => String(s).trim()).filter(Boolean);
  if (daten.prioritaet !== undefined) {
    if (!PRIORITAETEN.includes(daten.prioritaet)) throw new Error('Ungültige Priorität');
    patch.prioritaet = daten.prioritaet;
  }
  if (daten.harteFrist !== undefined) patch.harte_frist = !!daten.harteFrist;
  if (daten.aufwandMinuten !== undefined) patch.aufwand_minuten = zahlOderNull(daten.aufwandMinuten);
  if (daten.leistungId !== undefined) patch.leistung_id = zahlOderNull(daten.leistungId);
  return patch;
}

// Mandats-Eckdaten der Kundenliste (Etappe 1) -- nur Felder uebernehmen, die im Aufruf
// vorkommen, damit ein Teil-Update (z.B. nur "aktiv") die anderen nicht leert.
function mandatsEckdaten(daten) {
  const patch = {};
  if (daten.mwstPeriode !== undefined) {
    if (daten.mwstPeriode && !MWST_PERIODEN.includes(daten.mwstPeriode)) throw new Error('Ungültige MWST-Periode');
    patch.mwst_periode = daten.mwstPeriode || null;
  }
  if (daten.lohnzahltag !== undefined) patch.lohnzahltag = zahlOderNull(daten.lohnzahltag);
  if (daten.zahlungslaufRhythmus !== undefined) {
    if (daten.zahlungslaufRhythmus && !ZAHLUNGSLAUF_RHYTHMEN.some((r) => r.wert === daten.zahlungslaufRhythmus)) {
      throw new Error('Ungültiger Rhythmus Zahlungslauf');
    }
    patch.zahlungslauf_rhythmus = daten.zahlungslaufRhythmus || null;
  }
  if (daten.abschlussWunschTag !== undefined) patch.abschluss_wunsch_tag = zahlOderNull(daten.abschlussWunschTag);
  if (daten.abschlussWunschMonat !== undefined) patch.abschluss_wunsch_monat = zahlOderNull(daten.abschlussWunschMonat);
  return patch;
}

const api = {
  // Frueher ein Server-Endpunkt, jetzt rein statische Werte (siehe constants.js).
  meta: async () => ({ statusWerte: STATUS_WERTE, prioritaeten: PRIORITAETEN, rhythmen: RHYTHMEN, faelligkeitTypen: FAELLIGKEIT_TYPEN }),

  // E-Mail-Versand laeuft ueber die Supabase Edge Function "send-mail" (SMTP-Zugangsdaten
  // liegen dort als Secrets, nicht im Frontend). ICS-Anhang wird hier im Browser gebaut
  // (lib/ics.js) und als Base64 mitgeschickt.
  mail: {
    status: async () => ({ konfiguriert: true }),
    // Auftraege per E-Mail: Mails aus dem Outlook-Ordner "Auftraege" in den Eingang holen
    // (Edge Function "mail-eingang").
    eingangAbholen: async () => {
      const { data, error } = await supabase.functions.invoke('mail-eingang', { body: {} });
      if (error) {
        if (error instanceof FunctionsHttpError) {
          const koerper = await fehlerKoerperLesen(error);
          throw new Error(koerper?.fehler || error.message);
        }
        if (/Failed to send/i.test(error.message)) {
          throw new Error('Keine Antwort von der Funktion «mail-eingang» (nicht eingerichtet oder Zeitüberschreitung beim Mailserver).');
        }
        throw new Error(error.message);
      }
      return data;
    },
    senden: async (daten) => {
      const body = { an: daten.an, betreff: daten.betreff, text: daten.text };
      if (daten.kalender) {
        const ics = baueICS({
          titel: daten.kalender.titel, beschreibung: daten.kalender.beschreibung,
          faelligkeit: daten.kalender.faelligkeit,
          uid: daten.pendenzId ? `pendenz-${daten.pendenzId}@pendenzenliste.local` : undefined,
        });
        body.icsBase64 = utf8ZuBase64(ics);
        body.icsDateiname = dateinameFuer(daten.kalender.titel);
      }
      await sendMailAufrufen(body);
      if (daten.pendenzId) {
        await supabase.from('pendenz_emails').insert({ pendenz_id: daten.pendenzId, an: daten.an, betreff: daten.betreff || null });
      }
      return { ok: true };
    },
    test: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const ziel = user?.email;
      if (!ziel) throw new Error('Keine E-Mail-Adresse fuer den Test gefunden.');
      await sendMailAufrufen({ an: ziel, betreff: 'Testmail Auftragsmanagement', text: 'Dies ist eine Testmail vom Auftragsmanagement.' });
      return { an: ziel };
    },
  },

  einstellungen: {
    smtpLesen: async () => ({ host: '', port: 587, secure: false, user: '', from: '', passwortGesetzt: false }),
    smtpSpeichern: async () => { throw new Error('SMTP-Einstellungen sind in der Supabase-Version noch nicht eingerichtet.'); },
    netzwerk: async () => ({ lan: [], tailscale: [] }),
  },

  mitarbeitende: {
    aktuelleId: aktuelleMitarbeiterId,
    liste: async (aktiv) => {
      let q = supabase.from('mitarbeitende').select('*').order('name');
      if (aktiv !== undefined) q = q.eq('aktiv', aktiv);
      const { data, error } = await q;
      pruefeFehler(error);
      return data.map((m) => ({ ...m, login_aktiv: !!m.auth_user_id }));
    },
    erstellen: async (daten) => {
      if (!daten.name || !String(daten.name).trim()) throw new Error('Name ist erforderlich');
      const { data, error } = await supabase.from('mitarbeitende')
        .insert({ name: daten.name.trim(), email: daten.email || null, aktiv: !!daten.aktiv })
        .select().single();
      pruefeFehler(error);
      return { ...data, login_aktiv: false };
    },
    aktualisieren: async (id, daten) => {
      const patch = {};
      if (daten.name !== undefined) patch.name = daten.name.trim();
      if (daten.email !== undefined) patch.email = daten.email || null;
      if (daten.aktiv !== undefined) patch.aktiv = !!daten.aktiv;
      if (daten.fokusstundenWoche !== undefined) {
        const stunden = Number(daten.fokusstundenWoche);
        if (!(stunden > 0 && stunden <= 60)) throw new Error('Fokusstunden: bitte einen Wert zwischen 1 und 60 eingeben.');
        patch.fokusstunden_woche = stunden;
      }
      const { data, error } = await supabase.from('mitarbeitende').update(patch).eq('id', id).select().single();
      pruefeFehler(error);
      return { ...data, login_aktiv: !!data.auth_user_id };
    },
    loeschen: async (id) => {
      const { error } = await supabase.from('mitarbeitende').delete().eq('id', id);
      pruefeFehler(error);
    },
  },

  mandanten: {
    liste: async (aktiv) => {
      let q = supabase.from('mandanten').select('*').order('name');
      if (aktiv !== undefined) q = q.eq('aktiv', aktiv);
      const { data, error } = await q;
      pruefeFehler(error);
      return data;
    },
    uebersicht: async () => {
      const { data, error } = await supabase.rpc('mandanten_uebersicht');
      pruefeFehler(error);
      return data.map((m) => ({ ...m, offenTotal: m.offene_pendenzen }));
    },
    holen: async (id) => {
      const { data, error } = await supabase.from('mandanten').select('*').eq('id', id).single();
      pruefeFehler(error);
      return data;
    },
    erstellen: async (daten) => {
      if (!daten.name || !String(daten.name).trim()) throw new Error('Name ist erforderlich');
      const { data, error } = await supabase.from('mandanten').insert({
        name: daten.name.trim(), kuerzel: daten.kuerzel || null, email: daten.email || null,
        // camelCase wie alle anderen Felder -- MandantModal schickt "geschaeftsfuehrungEmail";
        // frueher wurde hier "geschaeftsfuehrung_email" gelesen und der Wert darum nie gespeichert.
        geschaeftsfuehrung_email: daten.geschaeftsfuehrungEmail || null,
        aktiv: daten.aktiv === undefined ? true : !!daten.aktiv, notizen: daten.notizen || null,
        ...mandatsEckdaten(daten),
        ...mandantAdresse(daten),
      }).select().single();
      pruefeFehler(error);
      return data;
    },
    aktualisieren: async (id, daten) => {
      const patch = {};
      if (daten.name !== undefined) patch.name = daten.name.trim();
      if (daten.kuerzel !== undefined) patch.kuerzel = daten.kuerzel || null;
      if (daten.email !== undefined) patch.email = daten.email || null;
      if (daten.geschaeftsfuehrungEmail !== undefined) patch.geschaeftsfuehrung_email = daten.geschaeftsfuehrungEmail || null;
      if (daten.aktiv !== undefined) patch.aktiv = !!daten.aktiv;
      if (daten.notizen !== undefined) patch.notizen = daten.notizen || null;
      Object.assign(patch, mandatsEckdaten(daten), mandantAdresse(daten));
      const { data, error } = await supabase.from('mandanten').update(patch).eq('id', id).select().single();
      pruefeFehler(error);
      return data;
    },
    loeschen: async (id) => {
      const { error } = await supabase.from('mandanten').delete().eq('id', id);
      pruefeFehler(error);
    },
  },

  // Preise (v7, Etappe 1): Stundenansaetze, Leistungskatalog, ABACUS-Module.
  preise: {
    ansaetze: standardansatzUmschalten(tabelle('stundenansaetze', {
      sortierung: [['ist_standard', false], ['name', true]],
      zuZeile: (d) => ({
        name: pflichtText(d.name, 'Name ist erforderlich'),
        chf_pro_stunde: (() => {
          const z = nichtNegativ(d.chfProStunde, 'Ungültiger Ansatz');
          if (z == null) throw new Error('CHF pro Stunde ist erforderlich');
          return z;
        })(),
        ist_standard: !!d.istStandard,
        aktiv: d.aktiv === undefined ? true : !!d.aktiv,
      }),
    })),
    leistungen: tabelle('leistungen', {
      sortierung: [['reihenfolge', true], ['name', true]],
      zuZeile: (d) => {
        const preisArt = d.preisArt === 'fix' ? 'fix' : 'zeit';
        return {
          name: pflichtText(d.name, 'Name ist erforderlich'),
          einheit: pflichtText(d.einheit, 'Einheit ist erforderlich'),
          turnus: d.turnus === 'jaehrlich' ? 'jaehrlich' : 'monatlich',
          preis_art: preisArt,
          minuten_pro_einheit: nichtNegativ(d.minutenProEinheit, 'Ungültige Zeit pro Einheit'),
          // Bei Festpreis = Zielansatz fuer die Kalkulation (maximale Stunden).
          stundenansatz_id: zahlOderNull(d.stundenansatzId),
          festpreis_pro_einheit: preisArt === 'fix' ? nichtNegativ(d.festpreisProEinheit, 'Ungültiger Preis') : null,
          angebot_gruppe: textOderNull(d.angebotGruppe),
          hinweis: textOderNull(d.hinweis),
          reihenfolge: zahlOderNull(d.reihenfolge),
          aktiv: d.aktiv === undefined ? true : !!d.aktiv,
        };
      },
    }),
    abacusModule: tabelle('abacus_module', {
      sortierung: [['reihenfolge', true], ['name', true]],
      zuZeile: (d) => ({
        name: pflichtText(d.name, 'Name ist erforderlich'),
        chf_pro_monat: (() => {
          const z = nichtNegativ(d.chfProMonat, 'Ungültiger Preis');
          if (z == null) throw new Error('CHF pro Monat ist erforderlich');
          return z;
        })(),
        einkaufspreis_pro_monat: nichtNegativ(d.einkaufspreisProMonat, 'Ungültiger Einkaufspreis'),
        hinweis: textOderNull(d.hinweis),
        reihenfolge: zahlOderNull(d.reihenfolge),
        aktiv: d.aktiv === undefined ? true : !!d.aktiv,
      }),
    }),
  },

  // Buero-Einstellungen (Absender, Offert-Texte) -- Schluessel/Wert.
  buero: {
    lesen: async (schluessel) => {
      const { data, error } = await supabase.from('buero_einstellungen').select('wert').eq('schluessel', schluessel).maybeSingle();
      pruefeFehler(error);
      return data?.wert ?? {};
    },
    speichern: async (schluessel, wert) => {
      const { error } = await supabase.from('buero_einstellungen')
        .upsert({ schluessel, wert, geaendert_am: new Date().toISOString() });
      pruefeFehler(error);
    },
  },

  // Dateien (v7): Mail-Anhaenge, eigene Uploads, Vorlagen der Onboarding-Unterlagen.
  dateien: {
    liste: async ({ pendenzIds, mandantId } = {}) => {
      let q = supabase.from('dateien').select('*').order('erstellt_am').order('id');
      if (pendenzIds) q = q.in('pendenz_id', pendenzIds.length ? pendenzIds : [-1]);
      if (mandantId) q = q.eq('mandant_id', mandantId);
      const { data, error } = await q;
      pruefeFehler(error);
      return data;
    },
    hochladen: async (file, { pendenzId = null, mandantId = null, quelle = 'upload' } = {}) => {
      const ordner = quelle === 'vorlage' ? 'vorlagen' : pendenzId ? `pendenzen/${pendenzId}` : `mandanten/${mandantId ?? 'ohne'}`;
      const pfad = `${ordner}/${Date.now()}-${sichererDateiname(file.name)}`;
      const typ = file.type || 'application/octet-stream';
      const { error: fehlerSpeicher } = await supabase.storage.from(BUCKET).upload(pfad, file, { contentType: typ });
      if (fehlerSpeicher) throw new Error(`Hochladen fehlgeschlagen: ${fehlerSpeicher.message}`);
      const { data, error } = await supabase.from('dateien').insert({
        pendenz_id: pendenzId, mandant_id: mandantId, dateiname: file.name, typ, groesse: file.size, speicherpfad: pfad, quelle,
      }).select().single();
      pruefeFehler(error);
      return data;
    },
    blob: dateiBlob,
    base64: async (datei) => blobZuBase64(await dateiBlob(datei)),
    // Kurzlebiger Link zum Anzeigen bzw. Herunterladen (Bucket ist nicht oeffentlich).
    link: async (datei, { herunterladen = false } = {}) => {
      const { data, error } = await supabase.storage.from(BUCKET)
        .createSignedUrl(datei.speicherpfad, 600, herunterladen ? { download: datei.dateiname } : undefined);
      if (error) throw new Error(error.message);
      return data.signedUrl;
    },
    abgelegt: async (id, ja = true) => {
      const { error } = await supabase.from('dateien').update({ abgelegt_am: ja ? new Date().toISOString() : null }).eq('id', id);
      pruefeFehler(error);
    },
    loeschen: async (datei) => {
      await supabase.storage.from(BUCKET).remove([datei.speicherpfad]);
      const { error } = await supabase.from('dateien').delete().eq('id', datei.id);
      pruefeFehler(error);
    },
  },

  // Onboarding (v7): Katalog der Unterlagen und pro Mandant ein Onboarding mit Checkliste.
  onboarding: {
    unterlagen: {
      liste: async () => {
        const { data, error } = await supabase.from('onboarding_unterlagen').select('*, datei:dateien(*)')
          .order('reihenfolge').order('name');
        pruefeFehler(error);
        return data;
      },
      speichern: async (id, d) => {
        const zeile = {
          name: String(d.name ?? '').trim(), beschreibung: textOderNull(d.beschreibung), zurueck: !!d.zurueck,
          aktiv: d.aktiv !== false, reihenfolge: Number(d.reihenfolge) || 0,
        };
        if (d.dateiId !== undefined) zeile.datei_id = d.dateiId;
        if (!zeile.name) throw new Error('Bitte einen Namen angeben.');
        const q = id ? supabase.from('onboarding_unterlagen').update(zeile).eq('id', id) : supabase.from('onboarding_unterlagen').insert(zeile);
        const { data, error } = await q.select().single();
        if (error?.message?.includes('onboarding_unterlagen_name_key')) throw new Error('Eine Unterlage mit diesem Namen existiert bereits.');
        pruefeFehler(error);
        return data;
      },
      // Vorlage (z.B. DL-Vertrag als PDF/Word) hochladen bzw. ersetzen.
      vorlageSetzen: async (unterlage, file) => {
        const datei = await api.dateien.hochladen(file, { quelle: 'vorlage' });
        const { error } = await supabase.from('onboarding_unterlagen').update({ datei_id: datei.id }).eq('id', unterlage.id);
        pruefeFehler(error);
        if (unterlage.datei) await api.dateien.loeschen(unterlage.datei);
      },
      loeschen: async (unterlage) => {
        const { error } = await supabase.from('onboarding_unterlagen').delete().eq('id', unterlage.id);
        pruefeFehler(error);
        if (unterlage.datei) await api.dateien.loeschen(unterlage.datei);
      },
    },
    holen: async (mandantId) => {
      const { data, error } = await supabase.from('mandant_onboarding').select('*').eq('mandant_id', mandantId).maybeSingle();
      pruefeFehler(error);
      return data;
    },
    // Startet das Onboarding mit allen aktiven Unterlagen aus dem Katalog als Checkliste.
    starten: async (mandantId, offerteId = null) => {
      const katalog = (await api.onboarding.unterlagen.liste()).filter((u) => u.aktiv);
      const { data, error } = await supabase.from('mandant_onboarding').insert({
        mandant_id: mandantId, offerte_id: offerteId,
        unterlagen: katalog.map((u) => ({ unterlageId: u.id, name: u.name, zurueck: u.zurueck, mitsenden: true, gesendetAm: null, erhaltenAm: null })),
      }).select().single();
      if (error?.message?.includes('mandant_onboarding_mandant_id_key')) throw new Error('Für diesen Mandanten läuft bereits ein Onboarding.');
      pruefeFehler(error);
      return data;
    },
    aktualisieren: async (id, patch) => {
      const { data, error } = await supabase.from('mandant_onboarding').update(patch).eq('id', id).select().single();
      pruefeFehler(error);
      return data;
    },
    loeschen: async (id) => {
      const { error } = await supabase.from('mandant_onboarding').delete().eq('id', id);
      pruefeFehler(error);
    },
    // Onboarding-Mail mit den Vorlagen der gewaehlten Unterlagen (und weiteren Dateien) senden.
    //   dateien: Vorlagen aus dem Speicher   zusatz: weitere Dateien vom PC (File-Objekte)
    versenden: async (onboarding, { an, betreff, text, dateien, zusatz = [], unterlagenIds }) => {
      if (!an || !String(an).trim()) throw new Error('Bitte eine E-Mail-Adresse angeben.');
      const anhaenge = [];
      for (const d of dateien) anhaenge.push({ dateiname: d.dateiname, base64: await api.dateien.base64(d), typ: d.typ || 'application/octet-stream' });
      for (const f of zusatz) anhaenge.push({ dateiname: f.name, base64: await blobZuBase64(f), typ: f.type || 'application/octet-stream' });
      await sendMailAufrufen({ an: an.trim(), betreff, text, anhaenge });
      const jetzt = new Date().toISOString();
      const unterlagen = (onboarding.unterlagen ?? []).map((u) => (unterlagenIds.includes(u.unterlageId) ? { ...u, gesendetAm: jetzt } : u));
      return api.onboarding.aktualisieren(onboarding.id, { unterlagen, mail_gesendet_am: jetzt, mail_an: an.trim() });
    },
  },

  // Offerten (v7).
  offerten: {
    liste: async () => {
      const { data, error } = await supabase.from('offerten')
        .select('*, mandanten(name, kunden_nr, potenziell), mitarbeitende(name), offert_positionen(menge, preis_pro_einheit, turnus)')
        .order('datum', { ascending: false }).order('id', { ascending: false });
      pruefeFehler(error);
      return data;
    },
    holen: async (id) => {
      const { data, error } = await supabase.from('offerten').select('*, offert_positionen(*)').eq('id', id).single();
      pruefeFehler(error);
      const { offert_positionen: positionen, ...kopf } = data;
      return { kopf, positionen: [...positionen].sort((a, b) => a.reihenfolge - b.reihenfolge || a.id - b.id) };
    },
    // Kopf speichern und Positionen vollstaendig ersetzen (eine Offerte hat wenige Zeilen).
    speichern: async (id, kopf, positionen) => {
      if (!kopf.mandant_id) throw new Error('Bitte einen Mandanten wählen.');
      if (!kopf.nummer) throw new Error('Angebot-Nr. fehlt.');
      const zeile = {
        nummer: String(kopf.nummer).trim(), mandant_id: Number(kopf.mandant_id), datum: kopf.datum, gueltig_bis: kopf.gueltig_bis,
        bearbeiter_id: zahlOderNull(kopf.bearbeiter_id), mwst_pflichtig: !!kopf.mwst_pflichtig,
        mwst_satz: zahlOderNull(kopf.mwst_satz) ?? 8.1, rabatt_prozent: zahlOderNull(kopf.rabatt_prozent) ?? 0,
        skonto_prozent: zahlOderNull(kopf.skonto_prozent) ?? 0, skonto_tage: zahlOderNull(kopf.skonto_tage),
        notiz: textOderNull(kopf.notiz),
      };
      const q = id ? supabase.from('offerten').update(zeile).eq('id', id) : supabase.from('offerten').insert(zeile);
      const { data, error } = await q.select().single();
      if (error?.message?.includes('offerten_nummer_key')) throw new Error(`Die Angebot-Nr. ${zeile.nummer} ist bereits vergeben.`);
      pruefeFehler(error);
      const { error: fehlerLoeschen } = await supabase.from('offert_positionen').delete().eq('offerte_id', data.id);
      pruefeFehler(fehlerLoeschen);
      if (positionen.length) {
        const { error: fehlerPos } = await supabase.from('offert_positionen').insert(positionen.map((p, i) => ({
          offerte_id: data.id, reihenfolge: i + 1, leistung_id: p.leistung_id ?? null, abacus_modul_id: p.abacus_modul_id ?? null,
          bezeichnung: p.bezeichnung, einheit: p.einheit ?? null, turnus: p.turnus === 'jaehrlich' ? 'jaehrlich' : 'monatlich',
          menge: zahlOderNull(p.menge) ?? 0, preis_pro_einheit: zahlOderNull(p.preis_pro_einheit) ?? 0,
          minuten_pro_einheit: zahlOderNull(p.minuten_pro_einheit), angebot_gruppe: p.angebot_gruppe ?? null, ist_lizenz: !!p.ist_lizenz,
        })));
        pruefeFehler(fehlerPos);
      }
      return data;
    },
    status: async (id, status) => {
      const { error } = await supabase.from('offerten').update({ status }).eq('id', id);
      pruefeFehler(error);
    },
    loeschen: async (id) => {
      const { error } = await supabase.from('offerten').delete().eq('id', id);
      pruefeFehler(error);
    },
    // Annahme = Mandatseroeffnung: Pauschalen anlegen (bisherige optional per Vortag beenden),
    // potenziellen Mandanten aktivieren, Offerte als angenommen markieren.
    annehmen: async (offerte, pauschalen, { ab, bisherigeBeenden }) => {
      if (!ab) throw new Error('Bitte «Pauschalen gültig ab» angeben.');
      if (bisherigeBeenden) {
        const vortag = new Date(`${ab}T12:00:00`);
        vortag.setDate(vortag.getDate() - 1);
        const bis = vortag.toISOString().slice(0, 10);
        const { error } = await supabase.from('mandant_pauschalen').update({ gueltig_bis: bis })
          .eq('mandant_id', offerte.mandant_id).lt('gueltig_ab', ab).or(`gueltig_bis.is.null,gueltig_bis.gte.${ab}`);
        pruefeFehler(error);
      }
      if (pauschalen.length) {
        const { error } = await supabase.from('mandant_pauschalen').insert(pauschalen.map((p) => ({
          ...p, mandant_id: offerte.mandant_id, gueltig_ab: ab, notiz: `aus Offerte ${offerte.nummer}`,
        })));
        pruefeFehler(error);
      }
      const { error: fehlerMandant } = await supabase.from('mandanten').update({ aktiv: true, potenziell: false }).eq('id', offerte.mandant_id);
      pruefeFehler(fehlerMandant);
      const { error } = await supabase.from('offerten')
        .update({ status: 'Angenommen', angenommen_am: heutigesDatumISO(), pauschalen_ab: ab }).eq('id', offerte.id);
      pruefeFehler(error);
    },
    // Versand per E-Mail mit der Offerte als PDF-Anhang.
    versenden: async (offerte, { an, betreff, text, pdfBase64, dateiname }) => {
      if (!an || !String(an).trim()) throw new Error('Bitte eine E-Mail-Adresse angeben.');
      await sendMailAufrufen({
        an: an.trim(), betreff, text,
        anhaenge: [{ dateiname, base64: pdfBase64, typ: 'application/pdf' }],
      });
      const patch = { versendet_am: new Date().toISOString(), versendet_an: an.trim() };
      if (offerte.status === 'Entwurf') patch.status = 'Versendet';
      const { error } = await supabase.from('offerten').update(patch).eq('id', offerte.id);
      pruefeFehler(error);
    },
  },

  // Zeiterfassung (v7, Etappe 2). Laufender Timer = minuten null (pro Person hoechstens einer).
  zeit: {
    liste: async (filter = {}) => {
      let q = supabase.from('zeiteintraege')
        .select('*, mandanten(name, kunden_nr), pendenzen(titel), leistungen(name), mitarbeitende(name)')
        .order('datum', { ascending: false }).order('id', { ascending: false });
      if (filter.von) q = q.gte('datum', filter.von);
      if (filter.bis) q = q.lte('datum', filter.bis);
      if (filter.mandantId === 'intern') q = q.is('mandant_id', null);
      else if (filter.mandantId) q = q.eq('mandant_id', Number(filter.mandantId));
      if (filter.mitarbeiterId) q = q.eq('mitarbeiter_id', Number(filter.mitarbeiterId));
      if (filter.art) q = q.eq('art', filter.art);
      if (filter.pendenzId) q = q.eq('pendenz_id', Number(filter.pendenzId));
      const { data, error } = await q;
      pruefeFehler(error);
      return data;
    },
    laufender: async () => {
      const ich = await aktuelleMitarbeiterId();
      if (!ich) return null;
      const { data, error } = await supabase.from('zeiteintraege')
        .select('*, mandanten(name), pendenzen(titel), leistungen(name)')
        .eq('mitarbeiter_id', ich).is('minuten', null).maybeSingle();
      pruefeFehler(error);
      return data;
    },
    // Timer starten. Laeuft schon einer, wird er mit seinen Angaben gestoppt (Korrektur im Journal).
    starten: async ({ pendenzId = null, mandantId = null, leistungId = null, art, beschreibung = null }) => {
      const ich = await aktuelleMitarbeiterId();
      if (!ich) throw new Error('Keine angemeldete Person gefunden.');
      const laufend = await api.zeit.laufender();
      let gestoppt = null;
      if (laufend) {
        const minuten = laufendeMinuten(laufend.timer_start);
        await api.zeit.speichern(laufend.id, {
          mandantId: laufend.mandant_id, pendenzId: laufend.pendenz_id, leistungId: laufend.leistung_id, art: laufend.art,
          datum: laufend.datum, minuten, beschreibung: laufend.beschreibung, stundenansatzChf: laufend.stundenansatz_chf,
        });
        gestoppt = { ...laufend, minuten };
      }
      const { data, error } = await supabase.from('zeiteintraege').insert({
        mitarbeiter_id: ich, pendenz_id: pendenzId, mandant_id: mandantId || null, leistung_id: leistungId || null,
        art: mandantId ? (art === 'extra' ? 'extra' : 'pauschal') : 'intern',
        beschreibung: textOderNull(beschreibung), datum: heutigesDatumISO(), timer_start: new Date().toISOString(), minuten: null,
      }).select().single();
      pruefeFehler(error);
      return { eintrag: data, gestoppt };
    },
    // Neu erfassen (id null) oder aendern/stoppen. Bei Extra wird der Ansatz festgehalten:
    // mitgegeben, sonst der Ansatz der Leistung bzw. der Standardansatz.
    speichern: async (id, d) => {
      if (id) await verrechnetPruefen(id);
      const minuten = Number(d.minuten);
      if (!(minuten > 0 && minuten <= 1440)) throw new Error('Bitte eine Dauer zwischen 1 Minute und 24 Stunden angeben.');
      if (!d.datum) throw new Error('Datum ist erforderlich.');
      const mandantId = zahlOderNull(d.mandantId);
      const art = mandantId ? (d.art === 'extra' ? 'extra' : 'pauschal') : 'intern';
      const leistungId = zahlOderNull(d.leistungId);
      let ansatz = art === 'extra' ? zahlOderNull(d.stundenansatzChf) : null;
      if (art === 'extra' && ansatz == null) {
        const [{ data: ansaetze }, { data: leistung }] = await Promise.all([
          supabase.from('stundenansaetze').select('*'),
          leistungId ? supabase.from('leistungen').select('*').eq('id', leistungId).maybeSingle() : Promise.resolve({ data: null }),
        ]);
        ansatz = ansatzFuer(leistung, ansaetze || []);
        if (ansatz == null) throw new Error('Kein Stundenansatz gefunden – bitte unter Preise & Katalog einen Standardansatz festlegen.');
      }
      const zeile = {
        mandant_id: mandantId, pendenz_id: zahlOderNull(d.pendenzId), leistung_id: leistungId, art,
        datum: d.datum, minuten, stundenansatz_chf: ansatz, beschreibung: textOderNull(d.beschreibung),
        // Beginn (Von-Uhrzeit bzw. Timer-Start) -- fuer die Anzeige "09:00–10:00".
        ...(d.beginn ? { timer_start: d.beginn } : {}),
      };
      let q;
      if (id) {
        q = supabase.from('zeiteintraege').update(zeile).eq('id', id);
      } else {
        q = supabase.from('zeiteintraege').insert({ ...zeile, mitarbeiter_id: zahlOderNull(d.mitarbeiterId) ?? await aktuelleMitarbeiterId() });
      }
      const { data, error } = await q.select().single();
      pruefeFehler(error);
      // Die Pendenz merkt sich die Leistung als Vorschlag fuer das naechste Mal.
      if (zeile.pendenz_id && leistungId) {
        await supabase.from('pendenzen').update({ leistung_id: leistungId }).eq('id', zeile.pendenz_id).is('leistung_id', null);
      }
      return data;
    },
    loeschen: async (id) => {
      await verrechnetPruefen(id);
      const { error } = await supabase.from('zeiteintraege').delete().eq('id', id);
      pruefeFehler(error);
    },
  },

  // Detailrapporte (v7, Etappe 3).
  rapporte: {
    liste: async () => {
      const { data, error } = await supabase.from('rapporte').select('*, mandanten(name, kunden_nr), mitarbeitende(name)')
        .order('datum', { ascending: false }).order('id', { ascending: false });
      pruefeFehler(error);
      return data;
    },
    holen: async (id) => {
      const { data, error } = await supabase.from('rapporte').select('*').eq('id', id).single();
      pruefeFehler(error);
      return data;
    },
    // Offene (noch nicht verrechnete) Zeit eines Mandanten im Zeitraum bzw. die Zeit eines
    // abgeschlossenen Rapports.
    eintraege: async ({ mandantId, von, bis, rapportId }) => {
      let q = supabase.from('zeiteintraege')
        .select('*, pendenzen(titel), leistungen(name), mitarbeitende(name)')
        .order('datum').order('id');
      if (rapportId) q = q.eq('rapport_id', rapportId);
      else q = q.eq('mandant_id', Number(mandantId)).gte('datum', von).lte('datum', bis).is('rapport_id', null).not('minuten', 'is', null);
      const { data, error } = await q;
      pruefeFehler(error);
      return data;
    },
    // Noch nicht verrechnete Mandanten-Zeit (fuer die Uebersicht "zu verrechnen").
    offen: async () => {
      const { data, error } = await supabase.from('zeiteintraege')
        .select('id, mandant_id, datum, minuten, art, stundenansatz_chf, mandanten(name)')
        .is('rapport_id', null).not('mandant_id', 'is', null).not('minuten', 'is', null);
      pruefeFehler(error);
      return data;
    },
    // Abschliessen: Rapport anlegen und die Eintraege als verrechnet markieren.
    abschliessen: async (kopf, ids, summen) => {
      if (!ids.length) throw new Error('Keine Zeit im Rapport – nichts zu verrechnen.');
      const { data, error } = await supabase.from('rapporte').insert({
        nummer: kopf.nummer, mandant_id: Number(kopf.mandant_id), von: kopf.von, bis: kopf.bis, datum: kopf.datum,
        bearbeiter_id: zahlOderNull(kopf.bearbeiter_id), runden_minuten: Number(kopf.runden_minuten) || 5,
        mwst_satz: Number(kopf.mwst_satz ?? 8.1), mwst_pflichtig: !!kopf.mwst_pflichtig,
        minuten_pauschal: summen.minutenPauschal, minuten_extra: summen.minutenExtra, betrag_extra: summen.betragExtra,
        rechnung_nr: textOderNull(kopf.rechnung_nr), bemerkung: textOderNull(kopf.bemerkung),
      }).select().single();
      if (error?.message?.includes('rapporte_nummer_key')) throw new Error(`Die Rapport-Nr. ${kopf.nummer} ist bereits vergeben.`);
      pruefeFehler(error);
      const { data: markiert, error: fehlerMarkieren } = await supabase.from('zeiteintraege')
        .update({ rapport_id: data.id }).in('id', ids).is('rapport_id', null).select('id');
      pruefeFehler(fehlerMarkieren);
      if (markiert.length !== ids.length) {
        // Inzwischen anderswo verrechnet: Rapport zuruecknehmen, damit nichts doppelt verrechnet wird.
        await supabase.from('zeiteintraege').update({ rapport_id: null }).eq('rapport_id', data.id);
        await supabase.from('rapporte').delete().eq('id', data.id);
        throw new Error('Ein Teil dieser Zeit wurde inzwischen in einem anderen Rapport verrechnet – bitte neu laden.');
      }
      return data;
    },
    aktualisieren: async (id, patch) => {
      const zeile = {};
      if (patch.rechnung_nr !== undefined) zeile.rechnung_nr = textOderNull(patch.rechnung_nr);
      if (patch.bemerkung !== undefined) zeile.bemerkung = textOderNull(patch.bemerkung);
      const { error } = await supabase.from('rapporte').update(zeile).eq('id', id);
      pruefeFehler(error);
    },
    // Stornieren: Verknuepfung loesen (Zeit wird wieder "offen"), Rapport entfernen.
    stornieren: async (id) => {
      const { error } = await supabase.from('zeiteintraege').update({ rapport_id: null }).eq('rapport_id', id);
      pruefeFehler(error);
      const { error: fehlerLoeschen } = await supabase.from('rapporte').delete().eq('id', id);
      pruefeFehler(fehlerLoeschen);
    },
    versenden: async (rapport, { an, betreff, text, pdfBase64, dateiname }) => {
      if (!an || !String(an).trim()) throw new Error('Bitte eine E-Mail-Adresse angeben.');
      await sendMailAufrufen({ an: an.trim(), betreff, text, anhaenge: [{ dateiname, base64: pdfBase64, typ: 'application/pdf' }] });
      const { error } = await supabase.from('rapporte').update({ versendet_am: new Date().toISOString(), versendet_an: an.trim() }).eq('id', rapport.id);
      pruefeFehler(error);
    },
  },

  // Vereinbarte Pauschalen pro Mandant (v7, Etappe 1).
  pauschalen: {
    ...tabelle('mandant_pauschalen', {
      sortierung: [['gueltig_ab', true], ['id', true]],
      zuZeile: (d) => {
        const betrag = nichtNegativ(d.betragMonat, 'Ungültiger Betrag');
        if (betrag == null) throw new Error('Betrag pro Monat ist erforderlich');
        if (!d.gueltigAb) throw new Error('«Gültig ab» ist erforderlich');
        return {
          mandant_id: Number(d.mandantId),
          leistung_id: zahlOderNull(d.leistungId),
          abacus_modul_id: zahlOderNull(d.abacusModulId),
          menge: nichtNegativ(d.menge, 'Ungültige Menge'),
          betrag_monat: betrag,
          gueltig_ab: d.gueltigAb,
          gueltig_bis: d.gueltigBis || null,
          notiz: textOderNull(d.notiz),
        };
      },
    }),
    // Ohne Mandant: alle Pauschalen (fuer die Summen in der Mandanten-Liste).
    liste: async (mandantId) => {
      let q = supabase.from('mandant_pauschalen').select('*').order('gueltig_ab').order('id');
      if (mandantId) q = q.eq('mandant_id', mandantId);
      const { data, error } = await q;
      pruefeFehler(error);
      return data;
    },
  },

  pendenzen: {
    liste: pendenzenListe,
    // Cockpit (Etappe 3): alle offenen, eingeplanten Pendenzen in einer Abfrage -- die
    // Bereiche (fällig in 5 Arbeitstagen, In Arbeit, Nachfassen, unverändert, Auslastung)
    // berechnet lib/cockpit.js daraus im Browser. Ersetzt die frühere RPC cockpit_daten().
    offene: () => pendenzenListe({ status: OFFENE_STATUS.join(',') }),
    holen: async (id) => {
      const { data, error } = await supabase.from('pendenzen_angereichert').select('*').eq('id', id).single();
      pruefeFehler(error);
      return data;
    },
    // Noch nicht eingeplante Notizen (siehe erstellen() geplant:false, z.B. aus MobilErfassen) --
    // fuer die "Eingang"-Uebersicht, damit sie nicht schon in Cockpit/Alle Pendenzen erscheinen.
    eingang: async () => {
      const { data, error } = await supabase.from('pendenzen_angereichert').select('*')
        .eq('geplant', false).order('erstellt_am', { ascending: false });
      pruefeFehler(error);
      return data;
    },
    // Leichtgewichtige Zaehlabfrage (kein Datentransfer) fuer die Eingang-Pille in der
    // Navigation -- muss nicht die vollen Datensaetze laden, nur die Anzahl.
    eingangAnzahl: async () => {
      const { count, error } = await supabase.from('pendenzen')
        .select('id', { count: 'exact', head: true }).eq('geplant', false).is('uebergeordnete_pendenz_id', null);
      pruefeFehler(error);
      return count ?? 0;
    },
    // Schritte eines Projekts in ihrer Reihenfolge (Projekt-Logik, Etappe 2).
    teilaufgaben: async (id) => {
      const { data, error } = await supabase.from('pendenzen_angereichert').select('*')
        .eq('uebergeordnete_pendenz_id', id)
        .order('reihenfolge', { ascending: true, nullsFirst: false }).order('id');
      pruefeFehler(error);
      return data;
    },
    // Zwei Schritte eines Projekts vertauschen. Der Datenbank-Trigger fuehrt danach automatisch
    // nach, welcher Schritt aktiv ("Offen") ist.
    reihenfolgeTauschen: async (a, b) => {
      const { error: fehlerA } = await supabase.from('pendenzen').update({ reihenfolge: b.reihenfolge }).eq('id', a.id);
      pruefeFehler(fehlerA);
      const { error: fehlerB } = await supabase.from('pendenzen').update({ reihenfolge: a.reihenfolge }).eq('id', b.id);
      pruefeFehler(fehlerB);
    },
    // Fuer das WIP-Limit: Pendenzen einer Person, die gerade "In Arbeit" sind. Projekt-Koepfe
    // (Hauptaufgaben mit Schritten) zaehlen nicht -- dort zaehlt der Schritt selbst.
    inArbeitVon: async (bearbeiterId, ausserId) => {
      let q = supabase.from('pendenzen_angereichert').select('id, titel, mandant_name')
        .eq('status', 'In Arbeit').eq('geplant', true).eq('teilaufgaben_gesamt', 0);
      q = bearbeiterId == null ? q.is('bearbeiter_id', null) : q.eq('bearbeiter_id', bearbeiterId);
      if (ausserId != null) q = q.neq('id', ausserId);
      const { data, error } = await q;
      pruefeFehler(error);
      return data;
    },
    // Nachfassen (Etappe 5): nach einer Erinnerung das naechste Nachfassdatum setzen und im
    // Fortschritt vermerken, dass nachgefasst wurde. Status bleibt "Warten auf".
    nachgefasst: async (id, neuesNachfassdatum, wie) => {
      const { error } = await supabase.from('pendenzen').update({ wiedervorlage: neuesNachfassdatum }).eq('id', id);
      pruefeFehler(error);
      await api.pendenzen.notizErstellen(id, `Nachgefasst (${wie}). Nächstes Nachfassen am ${neuesNachfassdatum.split('-').reverse().join('.')}.`);
    },
    // Wochenziel markieren (Montag der Zielwoche) bzw. aufheben (null).
    wochenzielSetzen: async (id, woche) => {
      const { error } = await supabase.from('pendenzen').update({ wochenziel_woche: woche }).eq('id', id);
      pruefeFehler(error);
    },
    // Triage im Eingang: "keine Aktion noetig" bzw. "in unter 2 Minuten sofort erledigt" --
    // beides wird als erledigt abgelegt (nichts geloescht) und mit einer Notiz begruendet.
    triageAblegen: async (id, art) => {
      const text = art === 'sofort'
        ? 'Triage: in unter 2 Minuten sofort erledigt.'
        : 'Triage: keine Aktion nötig – abgelegt.';
      await api.pendenzen.notizErstellen(id, text);
      return api.pendenzen.aktualisieren(id, { status: 'Erledigt' });
    },
    emails: async (id) => {
      const { data, error } = await supabase.from('pendenz_emails').select('id, an, betreff, gesendet_am')
        .eq('pendenz_id', id).order('gesendet_am', { ascending: false });
      pruefeFehler(error);
      return data;
    },
    notizen: async (id) => {
      const { data, error } = await supabase.from('pendenz_notizen')
        .select('id, text, erstellt_am, mitarbeitende(name)')
        .eq('pendenz_id', id).order('erstellt_am', { ascending: false });
      pruefeFehler(error);
      return data.map(({ mitarbeitende, ...rest }) => ({ ...rest, mitarbeiter_name: mitarbeitende?.name ?? null }));
    },
    notizErstellen: async (id, text) => {
      if (!text || !text.trim()) throw new Error('Text ist erforderlich');
      const mitarbeiterId = await aktuelleMitarbeiterId();
      const { data, error } = await supabase.from('pendenz_notizen')
        .insert({ pendenz_id: id, text: text.trim(), mitarbeiter_id: mitarbeiterId })
        .select('id, text, erstellt_am, mitarbeitende(name)').single();
      pruefeFehler(error);
      const { mitarbeitende, ...rest } = data;
      return { ...rest, mitarbeiter_name: mitarbeitende?.name ?? null };
    },
    notizLoeschen: async (_id, notizId) => {
      const { error } = await supabase.from('pendenz_notizen').delete().eq('id', notizId);
      pruefeFehler(error);
    },
    erstellen: async (daten) => {
      pendenzPayloadValidieren(daten, { neuer: true });
      if (!PRIORITAETEN.includes(daten.prioritaet || 'B')) throw new Error('Ungültige Priorität');
      const status = daten.status || 'Offen';
      if (!STATUS_WERTE.includes(status)) throw new Error('Ungültiger Status');
      const wartet = status === 'Warten auf';
      pruefeWartenAuf(status, daten.wartenAufPerson, daten.wiedervorlage);
      const { data, error } = await supabase.from('pendenzen').insert({
        titel: daten.titel.trim(),
        mandant_id: daten.mandantId ?? null,
        bearbeiter_id: daten.bearbeiterId ?? null,
        beschreibung: daten.beschreibung || null,
        faelligkeit: daten.faelligkeit || null,
        harte_frist: !!daten.harteFrist,
        prioritaet: daten.prioritaet || 'B',
        status,
        aufwand_minuten: zahlOderNull(daten.aufwandMinuten),
        block: daten.block || 'Sonstiges',
        warten_auf_person: wartet ? daten.wartenAufPerson.trim() : null,
        warte_seit: wartet ? (daten.warteSeit || heutigesDatumISO()) : null,
        wiedervorlage: wartet ? daten.wiedervorlage : null,
        bearbeitungstag: daten.bearbeitungstag || null,
        ...(daten.leistungId ? { leistung_id: Number(daten.leistungId) } : {}),
        ...(daten.verrechnung ? { verrechnung: daten.verrechnung === 'extra' ? 'extra' : 'pauschal' } : {}),
        uebergeordnete_pendenz_id: daten.uebergeordnetePendenzId ?? null,
        reihenfolge: daten.reihenfolge ?? null,
        // Mobil-Erfassen (siehe MobilErfassen.jsx) uebergibt explizit geplant:false -- so eine
        // Notiz landet im Eingang statt sofort in Cockpit/Alle Pendenzen aufzutauchen.
        geplant: daten.geplant === undefined ? true : !!daten.geplant,
      }).select().single();
      pruefeFehler(error);
      return data;
    },
    aktualisieren: async (id, daten) => {
      pendenzPayloadValidieren(daten, { neuer: false });
      const patch = {};
      if (daten.titel !== undefined) {
        if (!String(daten.titel).trim()) throw new Error('Nächster Schritt ist erforderlich');
        patch.titel = daten.titel.trim();
      }
      if (daten.status !== undefined) {
        if (!STATUS_WERTE.includes(daten.status)) throw new Error('Ungültiger Status');
        patch.status = daten.status;
        patch.erledigt_am = daten.status === 'Erledigt' ? (daten.erledigtAm || heutigesDatumISO()) : null;
        if (daten.status === 'Warten auf') {
          pruefeWartenAuf(daten.status, daten.wartenAufPerson, daten.wiedervorlage);
          patch.warten_auf_person = daten.wartenAufPerson.trim();
          patch.wiedervorlage = daten.wiedervorlage;
          patch.warte_seit = daten.warteSeit || heutigesDatumISO();
        } else {
          // Wer "Warten auf" verlaesst (z.B. Antwort erhalten), verliert Person/Nachfassdatum --
          // sonst taucht beim naechsten Wechsel zurueck ein altes Datum sofort in "Nachfassen"
          // auf (siehe Bugfix v4).
          patch.warten_auf_person = null;
          patch.wiedervorlage = null;
          patch.warte_seit = null;
        }
      }
      if (daten.prioritaet !== undefined) {
        if (!PRIORITAETEN.includes(daten.prioritaet)) throw new Error('Ungültige Priorität');
        patch.prioritaet = daten.prioritaet;
      }
      if (daten.mandantId !== undefined) patch.mandant_id = daten.mandantId;
      if (daten.bearbeiterId !== undefined) patch.bearbeiter_id = daten.bearbeiterId;
      if (daten.beschreibung !== undefined) patch.beschreibung = daten.beschreibung || null;
      if (daten.faelligkeit !== undefined) patch.faelligkeit = daten.faelligkeit || null;
      if (daten.harteFrist !== undefined) patch.harte_frist = !!daten.harteFrist;
      if (daten.aufwandMinuten !== undefined) patch.aufwand_minuten = zahlOderNull(daten.aufwandMinuten);
      if (daten.block !== undefined) patch.block = daten.block || 'Sonstiges';
      if (daten.bearbeitungstag !== undefined) patch.bearbeitungstag = daten.bearbeitungstag || null;
      if (daten.leistungId !== undefined) patch.leistung_id = zahlOderNull(daten.leistungId);
      if (daten.verrechnung !== undefined) patch.verrechnung = daten.verrechnung === 'extra' ? 'extra' : 'pauschal';
      // Vollstaendiges Bearbeiten/Speichern gilt immer als "eingeplant" -- so verlaesst eine
      // Eingang-Notiz automatisch den Eingang, sobald sie im normalen Formular gespeichert wird.
      patch.geplant = true;

      // Frist eines Projekts geaendert: vorher die alte Frist merken, damit die Schritte mitgehen.
      let alteFrist = null;
      if (patch.faelligkeit) {
        const { data: vorher } = await supabase.from('pendenzen').select('faelligkeit, uebergeordnete_pendenz_id').eq('id', id).single();
        if (vorher?.faelligkeit && vorher.uebergeordnete_pendenz_id == null && vorher.faelligkeit !== patch.faelligkeit) alteFrist = vorher.faelligkeit;
      }

      const { data, error } = await supabase.from('pendenzen').update(patch).eq('id', id).select().single();
      pruefeFehler(error);
      // Schritte, die schon waehrend des Einplanens aus dem Eingang angelegt wurden, werden
      // zusammen mit ihrem Projekt sichtbar.
      const { error: fehlerSchritte } = await supabase.from('pendenzen').update({ geplant: true })
        .eq('uebergeordnete_pendenz_id', id).eq('geplant', false);
      pruefeFehler(fehlerSchritte);
      // Offene Schritte uebernehmen die Fristaenderung: Schritte mit derselben Frist wie das
      // Projekt erhalten die neue Frist, eigene Fristen verschieben sich um gleich viele Tage.
      if (alteFrist) {
        const tage = Math.round((Date.parse(`${patch.faelligkeit}T00:00:00Z`) - Date.parse(`${alteFrist}T00:00:00Z`)) / 86400000);
        const { data: schritte, error: fehlerLesen } = await supabase.from('pendenzen').select('id, faelligkeit')
          .eq('uebergeordnete_pendenz_id', id).neq('status', 'Erledigt');
        pruefeFehler(fehlerLesen);
        for (const s of schritte) {
          const { error: fehlerFrist } = await supabase.from('pendenzen')
            .update({ faelligkeit: datumPlusTage(s.faelligkeit, tage) }).eq('id', s.id);
          pruefeFehler(fehlerFrist);
        }
      }
      return data;
    },
    // Schnell-Statuswechsel (Dropdown in Liste/Vorschau, Abhaken). "Warten auf" geht hier nur,
    // wenn Person + Nachfassdatum schon hinterlegt sind -- sonst oeffnen die Listen dafuer das
    // Bearbeiten-Fenster (siehe statusWechselBrauchtFormular).
    statusAendern: async (id, status) => {
      if (!STATUS_WERTE.includes(status)) throw new Error('Ungültiger Status');
      const patch = { status, erledigt_am: status === 'Erledigt' ? heutigesDatumISO() : null };
      if (status === 'Warten auf') {
        const { data: bestehend } = await supabase.from('pendenzen')
          .select('warte_seit, warten_auf_person, wiedervorlage').eq('id', id).single();
        pruefeWartenAuf(status, bestehend?.warten_auf_person, bestehend?.wiedervorlage);
        if (!bestehend.warte_seit) patch.warte_seit = heutigesDatumISO();
      } else {
        if (status === 'In Arbeit') {
          // Wer etwas in Arbeit nimmt, ist dafuer zustaendig -- ohne Bearbeiter/in wird die
          // Pendenz der angemeldeten Person zugewiesen (zaehlt dann zu deren WIP-Limit).
          const { data: bestehend } = await supabase.from('pendenzen').select('bearbeiter_id').eq('id', id).single();
          if (bestehend && bestehend.bearbeiter_id == null) patch.bearbeiter_id = await aktuelleMitarbeiterId();
        }
        // Verlaesst die Pendenz "Warten auf" (z.B. Antwort erhalten), muessen Person und
        // Nachfassdatum geloescht werden -- sonst bleibt ein altes Nachfassdatum im Hintergrund
        // gespeichert und taucht beim naechsten Wechsel zurueck auf "Warten auf" faelschlich
        // sofort mit dem alten (laengst vergangenen) Datum wieder auf.
        patch.warte_seit = null;
        patch.wiedervorlage = null;
        patch.warten_auf_person = null;
      }
      const { data, error } = await supabase.from('pendenzen').update(patch).eq('id', id).select().single();
      pruefeFehler(error);
      return data;
    },
    loeschen: async (id) => {
      // Angehaengte Dateien (z.B. Mail-Anhaenge) auch aus dem Speicher entfernen -- die Zeilen
      // in "dateien" loescht die Datenbank mit (on delete cascade).
      await dateienDerPendenzEntfernen(id);
      const { error } = await supabase.from('pendenzen').delete().eq('id', id);
      pruefeFehler(error);
    },
    // Erledigte Auftraege eines Mandanten (Projekte bzw. einzelne Pendenzen, ohne Teilschritte).
    erledigteVon: async (mandantId) => {
      const { data, error } = await supabase.from('pendenzen_angereichert').select('*')
        .eq('mandant_id', mandantId).eq('status', 'Erledigt').is('uebergeordnete_pendenz_id', null)
        .order('erledigt_am', { ascending: false, nullsFirst: false }).limit(200);
      pruefeFehler(error);
      return data;
    },
  },

  // Wochenrueckblick (Etappe 5): ein Eintrag pro Person und Woche (woche = Montag).
  wochenrueckblick: {
    holen: async (woche) => {
      const mitarbeiterId = await aktuelleMitarbeiterId();
      const { data, error } = await supabase.from('wochenrueckblicke').select('*')
        .eq('mitarbeiter_id', mitarbeiterId).eq('woche', woche).maybeSingle();
      pruefeFehler(error);
      return data ?? { mitarbeiter_id: mitarbeiterId, woche, checkliste: {}, liegen_geblieben: '', anders_machen: '' };
    },
    speichern: async (woche, daten) => {
      const mitarbeiterId = await aktuelleMitarbeiterId();
      if (!mitarbeiterId) throw new Error('Kein Profil für die angemeldete Person gefunden.');
      const zeile = { mitarbeiter_id: mitarbeiterId, woche };
      if (daten.checkliste !== undefined) zeile.checkliste = daten.checkliste;
      if (daten.liegenGeblieben !== undefined) zeile.liegen_geblieben = daten.liegenGeblieben || null;
      if (daten.andersMachen !== undefined) zeile.anders_machen = daten.andersMachen || null;
      const { data, error } = await supabase.from('wochenrueckblicke')
        .upsert(zeile, { onConflict: 'mitarbeiter_id,woche' }).select().single();
      pruefeFehler(error);
      return data;
    },
    // Fruehere Wochen mit beantworteten Fragen, neueste zuerst.
    verlauf: async (vorWoche, anzahl = 12) => {
      const mitarbeiterId = await aktuelleMitarbeiterId();
      const { data, error } = await supabase.from('wochenrueckblicke')
        .select('woche, liegen_geblieben, anders_machen, aktualisiert_am')
        .eq('mitarbeiter_id', mitarbeiterId).lt('woche', vorWoche)
        .order('woche', { ascending: false }).limit(anzahl);
      pruefeFehler(error);
      return data.filter((r) => r.liegen_geblieben || r.anders_machen);
    },
  },

  regeln: {
    liste: async () => {
      const { data, error } = await supabase.from('wiederkehr_regeln').select('*, mandanten(name, kuerzel)')
        .order('aktiv', { ascending: false }).order('titel_vorlage');
      pruefeFehler(error);
      return data.map(({ mandanten, ...r }) => ({ ...r, mandant_name: mandanten?.name ?? null, mandant_kuerzel: mandanten?.kuerzel ?? null }));
    },
    holen: async (id) => {
      const { data, error } = await supabase.from('wiederkehr_regeln').select('*').eq('id', id).single();
      pruefeFehler(error);
      return data;
    },
    vorschau: async (id, anzahl = 3) => {
      const { data, error } = await supabase.from('wiederkehr_regeln').select('*').eq('id', id).single();
      pruefeFehler(error);
      return naechstePendenzen(data, heutigesDatumUTC(), anzahl);
    },
    erstellen: async (daten) => {
      if (!daten.titelVorlage || !String(daten.titelVorlage).trim()) throw new Error('Titel-Vorlage ist erforderlich');
      const { data, error } = await supabase.from('wiederkehr_regeln').insert({
        titel_vorlage: daten.titelVorlage.trim(),
        mandant_id: daten.mandantId ?? null,
        rhythmus: daten.rhythmus,
        faelligkeit_typ: daten.faelligkeitTyp,
        faelligkeit_config: daten.faelligkeitConfig || {},
        vorlauf_tage: Number(daten.vorlaufTage) || 0,
        aktiv: daten.aktiv === undefined ? true : !!daten.aktiv,
        ...regelZusatzfelder(daten),
      }).select().single();
      pruefeFehler(error);
      return data;
    },
    aktualisieren: async (id, daten) => {
      const patch = {};
      if (daten.titelVorlage !== undefined) patch.titel_vorlage = daten.titelVorlage.trim();
      if (daten.mandantId !== undefined) patch.mandant_id = daten.mandantId;
      if (daten.rhythmus !== undefined) patch.rhythmus = daten.rhythmus;
      if (daten.faelligkeitTyp !== undefined) patch.faelligkeit_typ = daten.faelligkeitTyp;
      if (daten.faelligkeitConfig !== undefined) patch.faelligkeit_config = daten.faelligkeitConfig;
      if (daten.vorlaufTage !== undefined) patch.vorlauf_tage = Number(daten.vorlaufTage);
      if (daten.aktiv !== undefined) patch.aktiv = !!daten.aktiv;
      Object.assign(patch, regelZusatzfelder(daten));
      const { data, error } = await supabase.from('wiederkehr_regeln').update(patch).eq('id', id).select().single();
      pruefeFehler(error);
      return data;
    },
    // "Wiederkehrende erzeugen" (Etappe 4): legt fuer alle aktiven Regeln die Pendenzen an, die
    // bis zum Stichtag erscheinen (Faelligkeit minus Vorlauf). Ohne Duplikate -- der eindeutige
    // Index regel_id + perioden_schluessel laesst bereits vorhandene einfach aus (auch wenn
    // zwei Personen gleichzeitig erzeugen). Die Checkliste der Regel wird als Projekt-Schritte
    // angelegt; der Datenbank-Trigger stellt alle ausser dem ersten auf "Später".
    // Stichtag: heute (taeglicher Automatik-Lauf beim Oeffnen der App) oder Freitag naechster
    // Woche (Knopf "fuer naechste Woche erzeugen").
    erzeugen: async (bisISO) => {
      const heute = heutigesDatumISO();
      const stichtag = bisISO || heute;
      const { data: regeln, error } = await supabase.from('wiederkehr_regeln').select('*').eq('aktiv', true);
      pruefeFehler(error);

      const erzeugt = [];
      for (const regel of regeln) {
        const kandidaten = faelligeVorkommen(regel, heute, stichtag);
        if (!kandidaten.length) continue;
        const checkliste = (Array.isArray(regel.checkliste) ? regel.checkliste : [])
          .map((s) => String(s).trim()).filter(Boolean);
        const gemeinsam = {
          mandant_id: regel.mandant_id,
          prioritaet: regel.prioritaet || 'B',
          block: regel.block || 'Sonstiges',
          harte_frist: !!regel.harte_frist,
          status: 'Offen',
          geplant: true,
          // Standard-Leistung (Zeiterfassung) an die erzeugten Pendenzen weitergeben.
          ...(regel.leistung_id ? { leistung_id: regel.leistung_id } : {}),
        };

        const { data: neu, error: fehlerNeu } = await supabase.from('pendenzen')
          .upsert(kandidaten.map((v) => ({
            ...gemeinsam,
            titel: v.titel,
            faelligkeit: v.faelligkeit,
            // Mit Checkliste steckt der Aufwand in den Schritten (Projekt-Kopf ohne eigenen).
            aufwand_minuten: checkliste.length ? null : (regel.aufwand_minuten ?? null),
            regel_id: regel.id,
            perioden_schluessel: v.periodenSchluessel,
          })), { onConflict: 'regel_id,perioden_schluessel', ignoreDuplicates: true })
          .select('id, titel, faelligkeit');
        pruefeFehler(fehlerNeu);

        for (const projekt of neu) {
          if (checkliste.length) {
            // Nacheinander einfuegen, damit die Projekt-Logik die Reihenfolge sauber nachfuehrt.
            for (const [index, schritt] of checkliste.entries()) {
              const { error: fehlerSchritt } = await supabase.from('pendenzen').insert({
                ...gemeinsam,
                titel: schritt,
                faelligkeit: projekt.faelligkeit,
                uebergeordnete_pendenz_id: projekt.id,
                reihenfolge: index + 1,
              });
              pruefeFehler(fehlerSchritt);
            }
          }
          erzeugt.push({ ...projekt, schritte: checkliste.length });
        }
      }
      return erzeugt;
    },
    loeschen: async (id) => {
      const { error } = await supabase.from('wiederkehr_regeln').delete().eq('id', id);
      pruefeFehler(error);
    },
  },
};

export default api;
