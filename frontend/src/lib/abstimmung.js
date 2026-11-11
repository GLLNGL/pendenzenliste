// Abstimmungen fuer den Jahresabschluss (v7): MWST und Sozialversicherungen (AHV, BVG, UVG,
// KTG) pro Mandant und Geschaeftsjahr. Soll/Ist mit Differenz. Reine Funktionen mit Tests.

const TOLERANZ = 1; // Differenzen unter CHF 1 gelten als Rundung

const BEREICHE = {
  mwst: { id: 'mwst', kurz: 'MWST', titel: 'Abstimmung MWST', ordner: ['MWST'] },
  ahv: {
    id: 'ahv', kurz: 'AHV', titel: 'Abstimmung AHV / IV / EO / ALV / FAK', ordner: ['Sozialversicherungen', 'AHV'],
    beitraege: [
      { bez: 'AHV / IV / EO', satz: 10.6, an: 50 },
      { bez: 'ALV', satz: 2.2, an: 50 },
      { bez: 'FAK', satz: '', an: 0 },
      { bez: 'Verwaltungskosten', satz: '', an: 0 },
    ],
  },
  bvg: {
    id: 'bvg', kurz: 'BVG', titel: 'Abstimmung BVG (berufliche Vorsorge)', ordner: ['Sozialversicherungen', 'BVG'],
    beitraege: [
      { bez: 'Spar- und Risikobeiträge', satz: '', betrag: '', an: 50 },
    ],
  },
  uvg: {
    id: 'uvg', kurz: 'UVG', titel: 'Abstimmung UVG (Unfallversicherung)', ordner: ['Sozialversicherungen', 'UVG'],
    beitraege: [
      { bez: 'Berufsunfall (BU)', satz: '', an: 0 },
      { bez: 'Nichtberufsunfall (NBU)', satz: '', an: 100 },
      { bez: 'UVG-Zusatz', satz: '', an: 0 },
    ],
  },
  ktg: {
    id: 'ktg', kurz: 'KTG', titel: 'Abstimmung KTG (Krankentaggeld)', ordner: ['Sozialversicherungen', 'KTG'],
    beitraege: [
      { bez: 'Krankentaggeld', satz: '', an: 50 },
    ],
  },
};

const STATUS = {
  offen: 'offen',
  in_arbeit: 'in Arbeit',
  abgestimmt: 'abgestimmt',
  entfaellt: 'entfällt',
};

// Zahl aus Eingabe: "1'234.50", "1234,5", "-12", Zahl; leer = null.
function zahl(wert) {
  if (wert == null || wert === '') return null;
  if (typeof wert === 'number') return Number.isFinite(wert) ? wert : null;
  const t = String(wert).replace(/['’\s]/g, '').replace(/CHF/gi, '').replace(',', '.');
  if (!/^[-+]?\d*\.?\d+$/.test(t)) return null;
  return Number(t);
}
const n = (wert) => zahl(wert) ?? 0;
const runden = (wert) => Math.round(wert * 100) / 100;
const summe = (liste, feld) => runden((liste ?? []).reduce((s, x) => s + n(feld ? x[feld] : x), 0));

// Differenz mit Bewertung: ok (unter Toleranz) | differenz | fehlt (Angaben unvollstaendig).
function differenz(ist, soll, vollstaendig = true) {
  if (!vollstaendig) return { betrag: null, ok: null };
  const betrag = runden(n(ist) - n(soll));
  return { betrag, ok: Math.abs(betrag) < TOLERANZ };
}

// ---------------------------------------------------------------------------------------------
// MWST
// ---------------------------------------------------------------------------------------------
function mwstPerioden(methode) {
  return methode === 'saldo' ? ['1. Semester', '2. Semester'] : ['1. Quartal', '2. Quartal', '3. Quartal', '4. Quartal'];
}

// Leere MWST-Abstimmung; Methode aus der Abrechnungsperiode des Mandanten (Semester = Saldosteuersatz).
function mwstLeer(mandant) {
  const methode = mandant?.mwst_periode === 'Semester' ? 'saldo' : 'effektiv';
  return {
    methode, sssSatz: '',
    perioden: mwstPerioden(methode).map((label) => ({ label, umsatz: '', steuer: '', vorsteuer: '', bezahlt: '' })),
    umsatzBuchhaltung: '', korrekturen: [], steuerKonto: '', vorsteuerKonto: '', saldoAbrechnungskonto: '',
  };
}

// Methode wechseln: Perioden anpassen, vorhandene Werte der gleichen Position behalten.
function mwstMethodeWechseln(daten, methode) {
  const labels = mwstPerioden(methode);
  return { ...daten, methode, perioden: labels.map((label, i) => ({ umsatz: '', steuer: '', vorsteuer: '', bezahlt: '', ...(daten.perioden?.[i] ?? {}), label })) };
}

function mwstBerechnen(d) {
  const saldo = d.methode === 'saldo';
  const perioden = d.perioden ?? [];
  const umsatzDeklariert = summe(perioden, 'umsatz');
  const steuerDeklariert = summe(perioden, 'steuer');
  const vorsteuerDeklariert = saldo ? 0 : summe(perioden, 'vorsteuer');
  const korrekturen = summe(d.korrekturen, 'betrag');
  const umsatzSoll = runden(n(d.umsatzBuchhaltung) + korrekturen);
  const zahllast = runden(steuerDeklariert - vorsteuerDeklariert);
  const bezahlt = summe(perioden, 'bezahlt');
  const offen = runden(zahllast - bezahlt);
  const hat = (w) => zahl(w) != null;
  const ergebnis = {
    umsatzDeklariert, steuerDeklariert, vorsteuerDeklariert, korrekturen, umsatzSoll, zahllast, bezahlt, offen,
    perioden: perioden.map((p) => ({ label: p.label, zahllast: runden(n(p.steuer) - (saldo ? 0 : n(p.vorsteuer))) })),
    diffUmsatz: differenz(umsatzDeklariert, umsatzSoll, hat(d.umsatzBuchhaltung)),
    diffSteuer: differenz(d.steuerKonto, steuerDeklariert, hat(d.steuerKonto)),
    diffVorsteuer: saldo ? { betrag: null, ok: null } : differenz(d.vorsteuerKonto, vorsteuerDeklariert, hat(d.vorsteuerKonto)),
    diffKonto: differenz(d.saldoAbrechnungskonto, offen, hat(d.saldoAbrechnungskonto)),
  };
  if (saldo) {
    // Saldosteuersatz: Steuer = deklarierter Umsatz (inkl. MWST) x Satz.
    ergebnis.steuerSoll = runden(umsatzDeklariert * n(d.sssSatz) / 100);
    ergebnis.diffSss = differenz(steuerDeklariert, ergebnis.steuerSoll, hat(d.sssSatz));
  }
  ergebnis.differenzen = [ergebnis.diffUmsatz, ergebnis.diffSteuer, ergebnis.diffVorsteuer, ergebnis.diffKonto, ergebnis.diffSss].filter((x) => x && x.ok != null);
  return ergebnis;
}

// ---------------------------------------------------------------------------------------------
// Sozialversicherungen
// ---------------------------------------------------------------------------------------------
// Leere Abstimmung; Beitragssaetze aus dem Vorjahr (falls vorhanden), Betraege nicht.
function svLeer(bereich, vorjahr = null) {
  const vorlage = vorjahr?.beitraege?.length
    ? vorjahr.beitraege.map((b) => ({ bez: b.bez, satz: b.satz ?? '', an: b.an ?? 0, ...(b.betrag !== undefined ? { betrag: '' } : {}) }))
    : BEREICHE[bereich].beitraege.map((b) => ({ ...b }));
  return { lohnsumme: '', korrekturen: [], beitraege: vorlage, abrechnung: '', akonto: '', saldoKonto: '', anAbzuege: '' };
}

function svBerechnen(d) {
  const korrekturen = summe(d.korrekturen, 'betrag');
  const massgebend = runden(n(d.lohnsumme) + korrekturen);
  const zeilen = (d.beitraege ?? []).map((b) => {
    const fix = zahl(b.betrag);
    const basis = zahl(b.basis) ?? massgebend;
    const soll = runden(fix != null ? fix : basis * n(b.satz) / 100);
    return { bez: b.bez, basis, soll, an: runden(soll * n(b.an) / 100) };
  });
  const sollTotal = summe(zeilen, 'soll');
  const anSoll = summe(zeilen, 'an');
  const hat = (w) => zahl(w) != null;
  const erwarteterSaldo = runden(n(d.abrechnung) - n(d.akonto));
  const ergebnis = {
    korrekturen, massgebend, zeilen, sollTotal, anSoll, erwarteterSaldo,
    diffAbrechnung: differenz(d.abrechnung, sollTotal, hat(d.abrechnung) && (hat(d.lohnsumme) || zeilen.some((z) => z.soll))),
    diffKonto: differenz(d.saldoKonto, erwarteterSaldo, hat(d.saldoKonto) && hat(d.abrechnung)),
    diffAN: differenz(d.anAbzuege, anSoll, hat(d.anAbzuege)),
  };
  ergebnis.differenzen = [ergebnis.diffAbrechnung, ergebnis.diffKonto, ergebnis.diffAN].filter((x) => x.ok != null);
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
  return [...basis, 'Jahresabschluss', String(jahr), ...BEREICHE[bereich].ordner];
}

// Standard-Geschaeftsjahr fuer den Abschluss: das Vorjahr (im Dezember das laufende Jahr).
function standardJahr(heute = new Date()) {
  return heute.getMonth() === 11 ? heute.getFullYear() : heute.getFullYear() - 1;
}

export {
  BEREICHE, STATUS, TOLERANZ, zahl, differenz, mwstPerioden, mwstLeer, mwstMethodeWechseln, mwstBerechnen,
  svLeer, svBerechnen, bewertungGesamt, abstimmungOrdner, standardJahr,
};
