// Abstimmungen fuer den Jahresabschluss (v7): MWST und Sozialversicherungen (AHV, BVG, UVG,
// KTG) pro Mandant und Geschaeftsjahr. Aufbau nach den bisherigen Excel-Abstimmungen:
//  - MWST: pro Periode ESTV-Abrechnung vs. Verbuchung (Abacus), Delta pro Periode und Spalte.
//  - Sozialversicherungen: FiBu (Erfolgsrechnung) vs. Lohnbuchhaltung (Kumulativjournal) vs.
//    Abrechnung der Versicherung. Erfolgsrechnung und Kumulativjournal werden einmal pro Mandant
//    und Jahr eingelesen ("Grundlagen") und von allen vier Versicherungen genutzt.
// Reine Funktionen mit Tests.

const TOLERANZ = 1; // Differenzen unter CHF 1 gelten als Rundung

const BEREICHE = {
  mwst: { id: 'mwst', kurz: 'MWST', titel: 'Abstimmung MWST', ordner: ['MWST'] },
  ahv: {
    id: 'ahv', kurz: 'AHV', titel: 'Abstimmung AHV / IV / EO / ALV / FAK', ordner: ['Sozialversicherungen', 'AHV'],
    konten: '5700',
    beitraege: [
      { bez: 'AHV / IV / EO', laAN: '6000', laAG: '9500' },
      { bez: 'ALV', laAN: '6010', laAG: '9510' },
      { bez: 'FAK', laAN: '', laAG: '9570' },
      { bez: 'Verwaltungskosten', laAN: '', laAG: '' },
    ],
  },
  bvg: {
    id: 'bvg', kurz: 'BVG', titel: 'Abstimmung BVG (Pensionskasse)', ordner: ['Sozialversicherungen', 'BVG'],
    konten: '5720',
    beitraege: [{ bez: 'BVG-Beiträge', laAN: '6200', laAG: '9700' }],
  },
  uvg: {
    id: 'uvg', kurz: 'UVG', titel: 'Abstimmung UVG (Unfallversicherung)', ordner: ['Sozialversicherungen', 'UVG'],
    konten: '5730',
    beitraege: [
      { bez: 'NBU', laAN: '6100', laAG: '9600' },
      { bez: 'BU', laAN: '', laAG: '9610' },
    ],
  },
  ktg: {
    id: 'ktg', kurz: 'KTG', titel: 'Abstimmung KTG (Krankentaggeld)', ordner: ['Sozialversicherungen', 'KTG'],
    konten: '5740',
    beitraege: [{ bez: 'KTG', laAN: '6170', laAG: '9670' }],
  },
};
const SV_BEREICHE = ['ahv', 'bvg', 'uvg', 'ktg'];
const GRUNDLAGEN = 'lohn_grundlagen'; // Bereich des Datensatzes mit Erfolgsrechnung + Kumulativjournal

const STATUS = {
  offen: 'offen',
  in_arbeit: 'in Arbeit',
  abgestimmt: 'abgestimmt',
  entfaellt: 'entfällt',
};

// Zahl aus Eingabe: "1'234.50", "1234,5", "-12", "(12)", Zahl; leer = null.
function zahl(wert) {
  if (wert == null || wert === '') return null;
  if (typeof wert === 'number') return Number.isFinite(wert) ? wert : null;
  let t = String(wert).replace(/['’\s ]/g, '').replace(/CHF/gi, '');
  if (/^\(.*\)$/.test(t)) t = `-${t.slice(1, -1)}`;
  if (/^-?\d+,\d+$/.test(t)) t = t.replace(',', '.');
  if (!/^[-+]?\d*\.?\d+$/.test(t)) return null;
  return Number(t);
}
const n = (wert) => zahl(wert) ?? 0;
const runden = (wert) => Math.round(wert * 100) / 100;
const summe = (liste, feld) => runden((liste ?? []).reduce((s, x) => s + n(feld ? x[feld] : x), 0));

// Differenz mit Bewertung: ok (unter Toleranz) | Differenz; null = Angaben unvollstaendig.
function differenz(ist, soll, vollstaendig = true) {
  if (!vollstaendig) return { betrag: null, ok: null };
  const betrag = runden(n(ist) - n(soll));
  return { betrag, ok: Math.abs(betrag) < TOLERANZ };
}

// "5000, 5003-5005" -> ['5000', '5003', '5004', '5005']
function nummernListe(text) {
  const liste = [];
  for (const teil of String(text ?? '').split(/[,;\s]+/).filter(Boolean)) {
    const bereich = /^(\d+)-(\d+)$/.exec(teil);
    if (bereich && Number(bereich[2]) - Number(bereich[1]) <= 500) {
      for (let i = Number(bereich[1]); i <= Number(bereich[2]); i++) liste.push(String(i));
    } else liste.push(teil);
  }
  return liste;
}

// ---------------------------------------------------------------------------------------------
// Grundlagen einlesen: Erfolgsrechnung / Saldenliste und Kumulativjournal (Abacus-Export)
// ---------------------------------------------------------------------------------------------
const kopfText = (z) => (z ?? []).map((f) => String(f ?? '').trim().toLowerCase());

/**
 * Tabelle (Zeilen aus CSV/Excel) erkennen und lesen.
 * @returns {{ art: 'journal', lohnarten: [{la, text, total}], personen }
 *          | { art: 'konten', konten: [{konto, text, saldo}] } | null}
 */
function grundlagenLesen(zeilen) {
  // Kumulativjournal: Spalten "LA" und "Total" (dazu Personal-Nr., Lohnartentext, Monate).
  const jKopf = zeilen.findIndex((z) => {
    const k = kopfText(z);
    return k.some((f) => f === 'la' || f === 'lohnart') && k.some((f) => /^total|^jahr/.test(f));
  });
  if (jKopf >= 0) {
    const k = kopfText(zeilen[jKopf]);
    const sLa = k.findIndex((f) => f === 'la' || f === 'lohnart');
    const sText = k.findIndex((f) => /lohnartentext|bezeichnung|text/.test(f));
    const sTotal = k.findIndex((f) => /^total|^jahr/.test(f));
    const sPers = k.findIndex((f) => /personal|pers\.?-?nr|^mitarbeiter/.test(f));
    const daten = zeilen.slice(jKopf + 1).filter((z) => /^\d+$/.test(String(z?.[sLa] ?? '').trim()) && zahl(z?.[sTotal]) != null);
    // Mit Personenzeilen: nur diese summieren (der Totalblock am Ende wuerde doppelt zaehlen).
    const mitPerson = sPers >= 0 ? daten.filter((z) => String(z[sPers] ?? '').trim() !== '') : [];
    const quelle = mitPerson.length ? mitPerson : daten;
    const nachLa = new Map();
    for (const z of quelle) {
      const la = String(z[sLa]).trim();
      const alt = nachLa.get(la) ?? { la, text: sText >= 0 ? String(z[sText] ?? '').trim() : '', total: 0 };
      alt.total = runden(alt.total + n(z[sTotal]));
      nachLa.set(la, alt);
    }
    const personen = mitPerson.length ? new Set(mitPerson.map((z) => String(z[sPers]).trim())).size : null;
    return { art: 'journal', lohnarten: [...nachLa.values()].sort((a, b) => Number(a.la) - Number(b.la)), personen };
  }
  // Erfolgsrechnung / Saldenliste: Konto-Nummer (4+ Ziffern), Bezeichnung, Saldo.
  const kKopf = zeilen.findIndex((z) => {
    const k = kopfText(z);
    return k.some((f) => /^(nummer|konto|kto|konto-?nr\.?)$/.test(f)) && k.some((f) => /saldo|betrag/.test(f));
  });
  if (kKopf >= 0) {
    const k = kopfText(zeilen[kKopf]);
    const sNr = k.findIndex((f) => /^(nummer|konto|kto|konto-?nr\.?)$/.test(f));
    const sText = k.findIndex((f) => /bezeichnung|text|kontobezeichnung/.test(f));
    const sSaldo = k.findIndex((f) => /saldo/.test(f)) >= 0 ? k.findIndex((f) => /saldo/.test(f)) : k.findIndex((f) => /betrag/.test(f));
    const konten = [];
    const gesehen = new Set();
    for (const z of zeilen.slice(kKopf + 1)) {
      const nr = String(z?.[sNr] ?? '').trim();
      if (!/^\d{4,}$/.test(nr) || zahl(z?.[sSaldo]) == null || gesehen.has(nr)) continue;
      gesehen.add(nr);
      konten.push({ konto: nr, text: sText >= 0 ? String(z[sText] ?? '').trim() : '', saldo: runden(n(z[sSaldo])) });
    }
    return konten.length ? { art: 'konten', konten } : null;
  }
  return null;
}

// Betrag (immer positiv) einer Liste von Konten bzw. Lohnarten.
function kontenBetrag(konten, nummern) {
  const set = new Set(nummernListe(nummern));
  return runden(Math.abs((konten ?? []).filter((k) => set.has(k.konto)).reduce((s, k) => s + n(k.saldo), 0)));
}
function laBetrag(lohnarten, nummern) {
  const set = new Set(nummernListe(nummern));
  return runden((lohnarten ?? []).filter((l) => set.has(l.la)).reduce((s, l) => s + Math.abs(n(l.total)), 0));
}

// ---------------------------------------------------------------------------------------------
// MWST: ESTV-Abrechnung vs. Verbuchung pro Periode (Steuer = (Umsatz - steuerfrei) x Satz,
// Zahllast = Steuer - Vorsteuer 1170 - Vorsteuer 1171 + 2203)
// ---------------------------------------------------------------------------------------------
const MWST_SPALTEN = [
  { feld: 'umsatz', label: 'Umsatz' },
  { feld: 'steuerfrei', label: 'Umsatz steuerfrei' },
  { feld: 'v1170', label: '1170 Vorsteuer' },
  { feld: 'v1171', label: '1171 Vorsteuer' },
  { feld: 'k2203', label: '2203' },
];
const leereZeile = () => ({ umsatz: '', steuerfrei: '', v1170: '', v1171: '', k2203: '' });

function mwstPerioden(rhythmus) {
  if (rhythmus === 'semester') return ['1. Semester', '2. Semester'];
  if (rhythmus === 'monat') return ['Jan.', 'Feb.', 'März', 'April', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'];
  return ['1. Quartal', '2. Quartal', '3. Quartal', '4. Quartal'];
}

// Leere MWST-Abstimmung; Rhythmus aus der Abrechnungsperiode des Mandanten.
function mwstLeer(mandant, vorjahr = null) {
  const rhythmus = vorjahr?.rhythmus ?? (mandant?.mwst_periode === 'Semester' ? 'semester' : 'quartal');
  const satz = vorjahr?.satz ?? 8.1;
  return { rhythmus, satz, perioden: mwstPerioden(rhythmus).map((label) => ({ label, satz: '', estv: leereZeile(), buch: leereZeile() })) };
}

function mwstRhythmusWechseln(daten, rhythmus) {
  return { ...daten, rhythmus, perioden: mwstPerioden(rhythmus).map((label, i) => ({ satz: '', estv: leereZeile(), buch: leereZeile(), ...(daten.perioden?.[i] ?? {}), label })) };
}

function mwstZeile(z, satz) {
  const steuer = runden((n(z.umsatz) - n(z.steuerfrei)) * satz / 100);
  return { steuer, zahllast: runden(steuer - n(z.v1170) - n(z.v1171) + n(z.k2203)) };
}

function mwstBerechnen(d) {
  const satzStandard = n(d.satz);
  const perioden = (d.perioden ?? []).map((p) => {
    const satz = zahl(p.satz) ?? satzStandard;
    const estv = mwstZeile(p.estv ?? {}, satz);
    const buch = mwstZeile(p.buch ?? {}, satz);
    const erfasst = MWST_SPALTEN.some((s) => zahl(p.estv?.[s.feld]) != null) && MWST_SPALTEN.some((s) => zahl(p.buch?.[s.feld]) != null);
    return { label: p.label, satz, estv, buch, delta: differenz(buch.zahllast, estv.zahllast, erfasst) };
  });
  const total = (seite) => {
    const t = Object.fromEntries(MWST_SPALTEN.map((s) => [s.feld, summe((d.perioden ?? []).map((p) => p[seite]?.[s.feld]))]));
    t.steuer = summe(perioden.map((p) => p[seite].steuer));
    t.zahllast = summe(perioden.map((p) => p[seite].zahllast));
    return t;
  };
  const estv = total('estv');
  const buch = total('buch');
  // Jahresabstimmung: Verbuchung - Abrechnung pro Spalte; Umsatzdifferenz x Satz = Steuerwirkung.
  const spalten = Object.fromEntries([...MWST_SPALTEN.map((s) => s.feld), 'steuer', 'zahllast'].map((f) => [f, runden(buch[f] - estv[f])]));
  const umsatzNetto = runden(spalten.umsatz - spalten.steuerfrei);
  const erklaert = runden(spalten.steuer - spalten.v1170 - spalten.v1171 + spalten.k2203);
  const erfasst = perioden.some((p) => p.delta.ok != null);
  const ergebnis = {
    perioden, estv, buch, spalten, umsatzNetto, erklaert,
    diffZahllast: differenz(buch.zahllast, estv.zahllast, erfasst),
    diffUmsatz: differenz(buch.umsatz, estv.umsatz, erfasst),
    check: runden(spalten.zahllast - erklaert), // muss 0 sein
  };
  ergebnis.differenzen = [ergebnis.diffUmsatz, ...perioden.map((p) => p.delta)].filter((x) => x.ok != null);
  return ergebnis;
}

// ---------------------------------------------------------------------------------------------
// Sozialversicherungen
// ---------------------------------------------------------------------------------------------
// Leere Abstimmung; Zuordnung (Konten, Lohnarten, Lohnkonten) aus dem Vorjahr, Betraege nicht.
function svLeer(bereich, vorjahr = null) {
  const v = BEREICHE[bereich];
  const beitraege = (vorjahr?.beitraege?.length ? vorjahr.beitraege : v.beitraege)
    .map((b) => ({ bez: b.bez ?? '', laAN: b.laAN ?? '', laAG: b.laAG ?? '', rechnung: '' }));
  const d = { konten: vorjahr?.konten ?? v.konten, beitraege, akonto: '', saldoBilanz: '', kontoBilanz: vorjahr?.kontoBilanz ?? '' };
  if (bereich === 'ahv') {
    d.lohnKonten = vorjahr?.lohnKonten ?? '';
    d.lohnKorrekturen = (vorjahr?.lohnKorrekturen ?? []).map((k) => ({ text: k.text, betrag: '' }));
    d.deklaration = '';
  } else {
    d.deklaration = '';
  }
  return d;
}

// Lohnkonten fuer die AHV-Lohnsumme: eingetragen, sonst alle Konten 5000-5099 der Erfolgsrechnung.
function lohnKontenVon(d, grundlagen) {
  if (String(d.lohnKonten ?? '').trim()) return nummernListe(d.lohnKonten);
  return (grundlagen?.konten ?? []).filter((k) => /^50\d\d$/.test(k.konto)).map((k) => k.konto);
}

function svBerechnen(d, grundlagen = {}) {
  const konten = grundlagen?.konten ?? [];
  const lohnarten = grundlagen?.lohnarten ?? [];
  const hatKonten = konten.length > 0;
  const hatJournal = lohnarten.length > 0;
  const fibu = kontenBetrag(konten, d.konten);
  const zeilen = (d.beitraege ?? []).map((b) => {
    const an = laBetrag(lohnarten, b.laAN);
    const ag = laBetrag(lohnarten, b.laAG);
    const lohn = runden(an + ag);
    return { bez: b.bez, an, ag, lohn, rechnung: zahl(b.rechnung), delta: differenz(b.rechnung, lohn, zahl(b.rechnung) != null && hatJournal) };
  });
  const an = summe(zeilen, 'an');
  const ag = summe(zeilen, 'ag');
  const lohn = runden(an + ag);
  const rechnungErfasst = zeilen.some((z) => z.rechnung != null);
  const rechnung = summe(zeilen.map((z) => z.rechnung));
  const abzugrenzen = runden(rechnung - n(d.akonto));
  const ergebnis = {
    fibu, an, ag, lohn, rechnung, zeilen, abzugrenzen, hatKonten, hatJournal,
    // 1. Aufwand FiBu = AG-Anteil laut Lohnjournal
    diffFibuJournal: differenz(fibu, ag, hatKonten && hatJournal),
    // 2. Abrechnung Versicherung = AN + AG laut Lohnjournal
    diffRechnung: differenz(rechnung, lohn, rechnungErfasst && hatJournal),
    // 3. Abrechnung = FiBu (AG) + AN-Abzuege
    diffRechnungFibu: differenz(rechnung, runden(fibu + an), rechnungErfasst && hatKonten && hatJournal),
    // 4. Abgrenzung / Kontokorrent laut Bilanz
    diffBilanz: differenz(d.saldoBilanz, abzugrenzen, zahl(d.saldoBilanz) != null && rechnungErfasst),
  };
  // Lohnsumme: Lohnkonten FiBu +/- Korrekturen = pflichtige Lohnsumme vs. Deklaration.
  if (d.lohnKorrekturen !== undefined) {
    const lohnKonten = lohnKontenVon(d, grundlagen);
    const lohnFibu = kontenBetrag(konten, lohnKonten.join(','));
    const korrekturen = summe(d.lohnKorrekturen, 'betrag');
    const pflichtig = runden(lohnFibu + korrekturen);
    const brutto = laBetrag(lohnarten, '5000');
    Object.assign(ergebnis, {
      lohnKonten: lohnKonten.map((k) => ({ konto: k, text: konten.find((x) => x.konto === k)?.text ?? '', betrag: kontenBetrag(konten, k) })),
      lohnFibu, korrekturen, pflichtig, brutto,
      diffDeklaration: differenz(d.deklaration, pflichtig, zahl(d.deklaration) != null && hatKonten),
      diffBrutto: differenz(brutto, lohnFibu, hatKonten && hatJournal && brutto > 0),
    });
  } else {
    const brutto = laBetrag(lohnarten, '5000');
    Object.assign(ergebnis, { brutto, diffDeklaration: differenz(d.deklaration, brutto, zahl(d.deklaration) != null && hatJournal) });
  }
  ergebnis.differenzen = [ergebnis.diffFibuJournal, ergebnis.diffRechnung, ergebnis.diffRechnungFibu, ergebnis.diffBilanz,
    ergebnis.diffDeklaration, ergebnis.diffBrutto, ...zeilen.map((z) => z.delta)].filter((x) => x && x.ok != null);
  // Saldo aus der Saldenliste, falls das Bilanzkonto darin vorkommt.
  if (String(d.kontoBilanz ?? '').trim()) {
    const k = konten.find((x) => x.konto === String(d.kontoBilanz).trim());
    if (k) ergebnis.saldoAusListe = runden(Math.abs(k.saldo));
  }
  return ergebnis;
}

// Gesamtbild fuer Liste/Status: alle erfassten Differenzen ok?
function bewertungGesamt(ergebnis) {
  const d = ergebnis?.differenzen ?? [];
  if (!d.length) return 'leer';
  return d.every((x) => x.ok) ? 'ok' : 'differenz';
}

// Ablageordner der Unterlagen: <Mandantenordner>/Jahresabschluss/<Jahr>/<Bereich>.
function abstimmungOrdner(basis, jahr, bereich) {
  if (!basis?.length) return null;
  const unter = bereich === GRUNDLAGEN ? ['Sozialversicherungen'] : BEREICHE[bereich].ordner;
  return [...basis, 'Jahresabschluss', String(jahr), ...unter];
}

// Standard-Geschaeftsjahr fuer den Abschluss: das Vorjahr (im Dezember das laufende Jahr).
function standardJahr(heute = new Date()) {
  return heute.getMonth() === 11 ? heute.getFullYear() : heute.getFullYear() - 1;
}

// Eingefuegter Block aus Excel (Tabulator/Zeilenumbruch) -> Zellen.
function tabellenBlock(text) {
  return String(text ?? '').replace(/\r/g, '').replace(/\n$/, '').split('\n').map((z) => z.split('\t'));
}

export {
  BEREICHE, SV_BEREICHE, GRUNDLAGEN, STATUS, TOLERANZ, MWST_SPALTEN, zahl, differenz, nummernListe, grundlagenLesen,
  kontenBetrag, laBetrag, mwstPerioden, mwstLeer, mwstRhythmusWechseln, mwstBerechnen, svLeer, svBerechnen, lohnKontenVon,
  bewertungGesamt, abstimmungOrdner, standardJahr, tabellenBlock,
};
