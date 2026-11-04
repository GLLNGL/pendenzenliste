// Standardwerte für wiederkehrende Mandatsarbeiten (Etappe 4) -- abgeleitet aus dem Typ und den
// Mandats-Eckdaten (MWST-Periode, Lohnzahltag, Rhythmus Zahlungslauf, Abschluss-Wunschtermin).
// Reine Funktion, damit sie sich mit `npm test` prüfen lässt. Alles bleibt im Regel-Fenster
// änderbar; die Vorlage ist nur ein Startpunkt.
//
// Standard-Vorläufe laut Arbeitsprozess:
//   Zahlungslauf      2 Arbeitstage
//   Lohnlauf          7 Tage vor Auszahlung (Lohnzahltag)
//   MWST              3 Wochen vor Einreichefrist (60 Tage nach Periodenende)
//   Mahnlauf          fixer Tag im Monat (erscheint am Tag selbst)
//   Jahresabschluss   6–8 Wochen vor Wunschtermin (hier 7 Wochen = 49 Tage)

const REGEL_TYPEN = ['Zahlungslauf', 'Lohnlauf', 'MWST', 'Mahnlauf', 'Jahresabschluss', 'Sonstiges'];

const BLOCK_JE_TYP = {
  Zahlungslauf: 'Zahlungen',
  Lohnlauf: 'Lohn',
  MWST: 'MWST',
  Mahnlauf: 'Debitoren',
  Jahresabschluss: 'Abschluss',
  Sonstiges: 'Sonstiges',
};

const CHECKLISTEN = {
  Zahlungslauf: [
    'Kreditorenbelege prüfen und in Abacus erfassen',
    'Zahlungsvorschlag in Abacus erstellen',
    'Zahlungen vom Mandanten freigeben lassen',
    'Zahlungsdatei an die Bank übermitteln',
  ],
  Lohnlauf: [
    'Mutationen erfassen (Ein-/Austritte, Lohnänderungen, Absenzen)',
    'Lohnlauf in Abacus rechnen und prüfen',
    'Lohnabrechnungen versenden',
    'Lohnzahlungen auslösen',
  ],
  MWST: [
    'Umsätze und Vorsteuern in Abacus abstimmen',
    'MWST-Abrechnung erstellen und prüfen',
    'Abrechnung vom Mandanten freigeben lassen',
    'Abrechnung bei der ESTV einreichen',
  ],
  Mahnlauf: [
    'Offene Posten prüfen',
    'Mahnvorschlag in Abacus erstellen',
    'Mahnungen versenden',
  ],
  Jahresabschluss: [
    'Abschlussunterlagen beim Mandanten einfordern',
    'Geschäftsfälle vollständig verbuchen',
    'Bilanzkonten abstimmen',
    'Abschlussbuchungen und Abgrenzungen erfassen',
    'Jahresrechnung erstellen und prüfen',
    'Jahresrechnung mit dem Mandanten besprechen',
  ],
  Sonstiges: [],
};

function zahlungslaufRhythmus(mandant) {
  const r = mandant?.zahlungslauf_rhythmus;
  return r === 'monatlich' || r === '14-taeglich' ? r : 'woechentlich';
}

function vorlageFuerTyp(typ, mandant) {
  const basis = {
    typ,
    block: BLOCK_JE_TYP[typ] ?? 'Sonstiges',
    checkliste: [...(CHECKLISTEN[typ] ?? [])],
    prioritaet: 'B',
    harteFrist: false,
    vorlaufEinheit: 'tage',
  };

  switch (typ) {
    case 'Zahlungslauf': {
      const rhythmus = zahlungslaufRhythmus(mandant);
      const monatlich = rhythmus === 'monatlich';
      return {
        ...basis,
        titelVorlage: monatlich ? 'Zahlungslauf {Monat} {Jahr} ausführen' : 'Zahlungslauf {Datum} ausführen',
        rhythmus,
        faelligkeitTyp: monatlich ? 'tag_des_monats' : 'wochentag',
        faelligkeitConfig: monatlich ? { tag: 25 } : { wochentag: 5 },
        vorlaufTage: 2,
        vorlaufEinheit: 'arbeitstage',
        harteFrist: true,
      };
    }
    case 'Lohnlauf':
      return {
        ...basis,
        titelVorlage: 'Lohnlauf {Monat} {Jahr} durchführen',
        rhythmus: 'monatlich',
        faelligkeitTyp: 'tag_des_monats',
        faelligkeitConfig: { tag: mandant?.lohnzahltag ?? 25 },
        vorlaufTage: 7,
        harteFrist: true,
      };
    case 'MWST': {
      const semester = mandant?.mwst_periode === 'Semester';
      return {
        ...basis,
        titelVorlage: semester ? 'MWST-Abrechnung {Halbjahr} {Jahr} einreichen' : 'MWST-Abrechnung {Quartal} {Jahr} einreichen',
        rhythmus: semester ? 'halbjaehrlich' : 'quartalsweise',
        faelligkeitTyp: 'tage_nach_periodenende',
        faelligkeitConfig: { tage: 60 },
        vorlaufTage: 21,
        harteFrist: true,
      };
    }
    case 'Mahnlauf':
      return {
        ...basis,
        titelVorlage: 'Mahnlauf {Monat} {Jahr} durchführen',
        rhythmus: 'monatlich',
        faelligkeitTyp: 'tag_des_monats',
        faelligkeitConfig: { tag: 10 },
        vorlaufTage: 0,
      };
    case 'Jahresabschluss':
      return {
        ...basis,
        titelVorlage: 'Jahresabschluss {Jahr} erstellen',
        rhythmus: 'jaehrlich',
        faelligkeitTyp: 'tag_monat_folgejahr',
        faelligkeitConfig: {
          tag: mandant?.abschluss_wunsch_tag ?? 30,
          monat: mandant?.abschluss_wunsch_monat ?? 6,
          jahre_offset: 1,
        },
        vorlaufTage: 49,
      };
    default:
      return {
        ...basis,
        titelVorlage: '',
        rhythmus: 'monatlich',
        faelligkeitTyp: 'tag_des_monats',
        faelligkeitConfig: { tag: 25 },
        vorlaufTage: 7,
      };
  }
}

export { REGEL_TYPEN, BLOCK_JE_TYP, vorlageFuerTyp };
