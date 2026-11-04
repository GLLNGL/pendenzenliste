// Datenzugriff ueber Supabase statt eines eigenen Express-Servers (Migration weg vom
// Buero-PC/Tailscale, siehe Migrationsplan). Absichtlich mit DERSELBEN Methodenform wie zuvor
// (api.pendenzen.liste(...) usw.), damit Views/Komponenten unveraendert bleiben koennen --
// nur hier drin aendert sich, WIE die Daten geholt werden.
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './lib/supabaseClient.js';
import { STATUS_WERTE, PRIORITAETEN, RHYTHMEN, FAELLIGKEIT_TYPEN, AUFWAND_MINUTEN, BLOECKE, MWST_PERIODEN, ZAHLUNGSLAUF_RHYTHMEN } from './constants.js';
import { naechstePendenzen, heutigesDatumUTC } from './lib/recurrence.js';
import { heutigesDatumISO } from './format.js';
import { baueICS, dateinameFuer } from './lib/ics.js';

// btoa() kann nur Latin1 -- Umlaute/Sonderzeichen in Titel/Beschreibung brauchen den Umweg
// ueber UTF-8-Bytes, sonst wirft btoa bei manchen Zeichen einen Fehler.
function utf8ZuBase64(text) {
  return btoa(unescape(encodeURIComponent(text)));
}

// Der tatsaechliche Funktionsname im Supabase-Dashboard ist "clever-processor" (von Supabase
// zufaellig vergeben, als "send-mail" umbenannt wurde nur der Anzeigename geaendert, nicht der
// Aufruf-Pfad) -- functions.invoke() braucht den echten Pfad, nicht den Anzeigenamen.
async function sendMailAufrufen(body) {
  const { data, error } = await supabase.functions.invoke('clever-processor', { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const fehlerKoerper = await error.context.json().catch(() => null);
      throw new Error(fehlerKoerper?.fehler || error.message);
    }
    throw new Error(error.message);
  }
  return data;
}

// Verletzte Datenbank-Regeln (Check-Constraints in supabase/schema.sql) als verstaendliche
// Meldung statt der rohen Postgres-Fehlermeldung anzeigen.
const CONSTRAINT_MELDUNGEN = {
  pendenzen_warten_auf_pflicht: 'Status «Warten auf» braucht eine Person und ein Nachfassdatum.',
  pendenzen_prioritaet_check: 'Ungültige Priorität (erlaubt: A, B, C).',
  pendenzen_status_check: 'Ungültiger Status.',
  pendenzen_aufwand_minuten_check: 'Ungültiger Aufwand (erlaubt: 15, 30, 60 oder 120 Minuten).',
  pendenzen_block_check: 'Ungültiger Block.',
};

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
  if (neuer && !payload.faelligkeit) throw new Error('Frist ist erforderlich');
  if (payload.aufwandMinuten != null && payload.aufwandMinuten !== '' && !AUFWAND_MINUTEN.includes(Number(payload.aufwandMinuten))) {
    throw new Error('Ungültiger Aufwand (erlaubt: 15, 30, 60 oder 120 Minuten)');
  }
  if (payload.block !== undefined && payload.block !== null && !BLOECKE.includes(payload.block)) throw new Error('Ungültiger Block');
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
      await sendMailAufrufen({ an: ziel, betreff: 'Testmail Pendenzenliste', text: 'Dies ist eine Testmail von der Pendenzenliste.' });
      return { an: ziel };
    },
  },

  einstellungen: {
    smtpLesen: async () => ({ host: '', port: 587, secure: false, user: '', from: '', passwortGesetzt: false }),
    smtpSpeichern: async () => { throw new Error('SMTP-Einstellungen sind in der Supabase-Version noch nicht eingerichtet.'); },
    netzwerk: async () => ({ lan: [], tailscale: [] }),
  },

  mitarbeitende: {
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
      Object.assign(patch, mandatsEckdaten(daten));
      const { data, error } = await supabase.from('mandanten').update(patch).eq('id', id).select().single();
      pruefeFehler(error);
      return data;
    },
    loeschen: async (id) => {
      const { error } = await supabase.from('mandanten').delete().eq('id', id);
      pruefeFehler(error);
    },
  },

  pendenzen: {
    liste: pendenzenListe,
    cockpit: async () => {
      const { data, error } = await supabase.rpc('cockpit_daten');
      pruefeFehler(error);
      return data;
    },
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
        .select('id', { count: 'exact', head: true }).eq('geplant', false);
      pruefeFehler(error);
      return count ?? 0;
    },
    teilaufgaben: async (id) => {
      const { data, error } = await supabase.from('pendenzen_angereichert').select('*')
        .eq('uebergeordnete_pendenz_id', id).order('faelligkeit');
      pruefeFehler(error);
      return data;
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
        faelligkeit: daten.faelligkeit,
        harte_frist: !!daten.harteFrist,
        prioritaet: daten.prioritaet || 'B',
        status,
        aufwand_minuten: zahlOderNull(daten.aufwandMinuten),
        block: daten.block || 'Sonstiges',
        warten_auf_person: wartet ? daten.wartenAufPerson.trim() : null,
        warte_seit: wartet ? (daten.warteSeit || heutigesDatumISO()) : null,
        wiedervorlage: wartet ? daten.wiedervorlage : null,
        bearbeitungstag: daten.bearbeitungstag || null,
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
      if (daten.faelligkeit !== undefined) patch.faelligkeit = daten.faelligkeit;
      if (daten.harteFrist !== undefined) patch.harte_frist = !!daten.harteFrist;
      if (daten.aufwandMinuten !== undefined) patch.aufwand_minuten = zahlOderNull(daten.aufwandMinuten);
      if (daten.block !== undefined) patch.block = daten.block || 'Sonstiges';
      if (daten.bearbeitungstag !== undefined) patch.bearbeitungstag = daten.bearbeitungstag || null;
      // Vollstaendiges Bearbeiten/Speichern gilt immer als "eingeplant" -- so verlaesst eine
      // Eingang-Notiz automatisch den Eingang, sobald sie im normalen Formular gespeichert wird.
      patch.geplant = true;

      const { data, error } = await supabase.from('pendenzen').update(patch).eq('id', id).select().single();
      pruefeFehler(error);
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
      const { error } = await supabase.from('pendenzen').delete().eq('id', id);
      pruefeFehler(error);
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
      const { data, error } = await supabase.from('wiederkehr_regeln').update(patch).eq('id', id).select().single();
      pruefeFehler(error);
      return data;
    },
    loeschen: async (id) => {
      const { error } = await supabase.from('wiederkehr_regeln').delete().eq('id', id);
      pruefeFehler(error);
    },
  },
};

export default api;
