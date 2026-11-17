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

/**
 * Zeiteintraege nach Pendenz (Projekt) gruppieren -- fuer die Rapport-Ansicht.
 * @param eintraege Zeiteintraege (mit pendenz_id, art, minuten, stundenansatz_chf)
 * @param pendenzen Map/Liste { id, titel, uebergeordnete_pendenz_id, eltern_titel }
 * @returns [{ schluessel, pendenzId, titel, minuten, art: 'pauschal'|'extra'|'gemischt', betrag, eintraege }]
 */
function nachPendenz(eintraege, pendenzen = [], { runden = 5 } = {}) {
  const nach = new Map((Array.isArray(pendenzen) ? pendenzen : [...pendenzen.values()]).map((p) => [p.id, p]));
  const gruppen = new Map();
  for (const e of eintraege) {
    if (e.minuten == null || e.art === 'intern') continue;
    const p = nach.get(e.pendenz_id);
    const projektId = p ? (p.uebergeordnete_pendenz_id ?? p.id) : null;
    const schluessel = projektId ?? `ohne-${e.beschreibung || ''}`;
    if (!gruppen.has(schluessel)) {
      const titel = p ? (p.uebergeordnete_pendenz_id ? (p.eltern_titel ?? p.titel) : p.titel) : (e.beschreibung || 'Ohne Pendenz');
      gruppen.set(schluessel, { schluessel, pendenzId: projektId, titel, minuten: 0, betrag: 0, eintraege: [] });
    }
    const g = gruppen.get(schluessel);
    const minuten = rundeMinuten(e.minuten, runden);
    g.minuten += minuten;
    if (e.art === 'extra') g.betrag = runden2(g.betrag + (minuten / 60) * Number(e.stundenansatz_chf ?? 0));
    g.eintraege.push({ ...e, schrittTitel: p && p.uebergeordnete_pendenz_id ? p.titel : null });
  }
  return [...gruppen.values()].map((g) => {
    const arten = new Set(g.eintraege.map((e) => e.art));
    // Teilaufgaben mit erfasster Zeit (in Projektreihenfolge der Eintraege), inkl. Status.
    const schritte = new Map();
    for (const e of g.eintraege) {
      const p = nach.get(e.pendenz_id);
      if (!p || !p.uebergeordnete_pendenz_id) continue;
      const s = schritte.get(p.id) ?? { id: p.id, titel: p.titel, status: p.status ?? null, minuten: 0 };
      s.minuten += rundeMinuten(e.minuten, runden);
      schritte.set(p.id, s);
    }
    return { ...g, art: arten.size > 1 ? 'gemischt' : [...arten][0], schritte: [...schritte.values()] };
  }).sort((a, b) => (a.titel ?? '').localeCompare(b.titel ?? '', 'de-CH'));
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

export { rundeMinuten, rapportDaten, nachPendenz, naechsteRapportNummer, stundenText };
