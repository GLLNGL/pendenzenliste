// Detailrapport (v7, Etappe 3) -- reine Logik ohne Datenbankzugriff.

// Rundung je Eintrag auf den naechsten Schritt (z.B. 5 Minuten), mindestens ein Schritt.
function rundeMinuten(minuten, schritt = 5) {
  if (!schritt || schritt <= 1) return Math.round(minuten);
  return Math.max(schritt, Math.round(minuten / schritt) * schritt);
}

function runden2(z) {
  return Math.round(z * 100) / 100;
}

// Zeilen und Summen eines Rapports. Interne Zeit und laufende Timer zaehlen nicht.
function rapportDaten(eintraege, { runden = 5, mwstPflichtig = true, mwstSatz = 8.1 } = {}) {
  const fertig = eintraege
    .filter((e) => e.minuten != null && e.art !== 'intern')
    .sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : a.id - b.id));
  const zeile = (e) => {
    const minuten = rundeMinuten(e.minuten, runden);
    return {
      id: e.id, datum: e.datum, text: e.beschreibung || e.pendenzen?.titel || '',
      leistung: e.leistungen?.name ?? '', person: e.mitarbeitende?.name ?? '', minuten,
      ansatz: e.art === 'extra' ? Number(e.stundenansatz_chf ?? 0) : null,
      betrag: e.art === 'extra' ? runden2((minuten / 60) * Number(e.stundenansatz_chf ?? 0)) : null,
    };
  };
  const pauschal = fertig.filter((e) => e.art === 'pauschal').map(zeile);
  const extra = fertig.filter((e) => e.art === 'extra').map(zeile);

  // Pauschal-Zeit je Leistung (Uebersicht fuer den Kunden, ohne Betraege).
  const proLeistung = new Map();
  for (const z of pauschal) {
    const name = z.leistung || 'Übrige Arbeiten';
    proLeistung.set(name, (proLeistung.get(name) ?? 0) + z.minuten);
  }

  const minutenPauschal = pauschal.reduce((s, z) => s + z.minuten, 0);
  const minutenExtra = extra.reduce((s, z) => s + z.minuten, 0);
  const betragExtra = runden2(extra.reduce((s, z) => s + z.betrag, 0));
  const mwst = mwstPflichtig ? runden2(betragExtra * (Number(mwstSatz) / 100)) : 0;
  return {
    pauschal, extra,
    pauschalProLeistung: [...proLeistung.entries()].map(([leistung, minuten]) => ({ leistung, minuten })),
    summen: { minutenPauschal, minutenExtra, betragExtra, mwst, total: runden2(betragExtra + mwst) },
    ids: fertig.map((e) => e.id),
  };
}

function naechsteRapportNummer(rapporte, jahr) {
  const praefix = `R-${jahr}-`;
  const hoechste = rapporte.reduce((max, r) => {
    if (!r.nummer?.startsWith(praefix)) return max;
    const n = Number(r.nummer.slice(praefix.length));
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);
  return `${praefix}${String(hoechste + 1).padStart(2, '0')}`;
}

// "2:30 h" fuer den Rapport.
function stundenText(minuten) {
  return `${Math.floor(minuten / 60)}:${String(minuten % 60).padStart(2, '0')} h`;
}

export { rundeMinuten, rapportDaten, naechsteRapportNummer, stundenText };
