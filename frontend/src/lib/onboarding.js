// Onboarding (v7): Stand der Checkliste und Phase eines Mandanten im Ablauf
// Interessent -> Offerte -> Angenommen -> Onboarding -> Aktiv.

function onboardingStand(onboarding) {
  const zeilen = onboarding?.unterlagen ?? [];
  const zurueck = zeilen.filter((z) => z.zurueck).length;
  const erhalten = zeilen.filter((z) => z.zurueck && z.erhaltenAm).length;
  return { zurueck, erhalten, offen: zurueck - erhalten, gesendet: zeilen.filter((z) => z.gesendetAm).length };
}

const PHASEN = [
  { key: 'erfasst', label: 'Erfasst' },
  { key: 'offerte', label: 'Offerte' },
  { key: 'angenommen', label: 'Angenommen' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'aktiv', label: 'Mandat läuft' },
];

// Index der erreichten Phase (0..4).
function phaseVon(mandant, offerten = [], onboarding = null) {
  if (onboarding?.abgeschlossen_am) return 4;
  if (onboarding) return 3;
  if (offerten.some((o) => o.status === 'Angenommen')) return 2;
  if (offerten.length) return 1;
  // Bestehende aktive Mandanten (vor dem Onboarding-Ablauf erfasst) gelten als laufend.
  if (mandant && mandant.aktiv && !mandant.potenziell) return 4;
  return 0;
}

export { onboardingStand, phaseVon, PHASEN };
