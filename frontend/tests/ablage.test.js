import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ablageVon, relativerOrdner, linkMitOrdner, ordnerVorschlag } from '../src/lib/ablage.js';
import { onboardingStand, phaseVon } from '../src/lib/onboarding.js';

const BS = String.fromCharCode(92); // Backslash
const p = (...teile) => teile.join(BS);
const grund = { grundPfad: `${p('C:', 'Users', 'a', 'OneDrive', 'Mandantenablage')}${BS}`, grundLink: 'https://x.sharepoint.com/sites/M/Freigegebene Dokumente/00_Treuhand' };

test('Pfad und Link aus Grundordner + Ordnername', () => {
  const a = ablageVon({ ablage_ordner: 'Muster AG' }, grund);
  assert.equal(a.pfad, p('C:', 'Users', 'a', 'OneDrive', 'Mandantenablage', 'Muster AG'));
  assert.equal(a.link, 'https://x.sharepoint.com/sites/M/Freigegebene%20Dokumente/00_Treuhand/Muster%20AG');
  assert.deepEqual(a.ordner, ['Muster AG']);
});

test('Abweichender Pfad/Link geht vor', () => {
  const a = ablageVon({ ablage_ordner: 'X', ablage_pfad: p('D:', 'Sonder'), ablage_link: 'https://y' }, grund);
  assert.equal(a.pfad, p('D:', 'Sonder'));
  assert.equal(a.link, 'https://y');
});

test('Ansichts-Link mit id-Parameter', () => {
  const l = linkMitOrdner('https://x.sharepoint.com/sites/M/Shared/Forms/AllItems.aspx?id=%2Fsites%2FM%2FShared%2F00', ['Muster AG']);
  assert.equal(new URL(l).searchParams.get('id'), '/sites/M/Shared/00/Muster AG');
});

test('Relativer Ordner aus altem vollen Pfad', () => {
  assert.deepEqual(relativerOrdner({ ablage_pfad: p('c:', 'users', 'a', 'onedrive', 'mandantenablage', 'Kunde', '2026') }, grund), ['Kunde', '2026']);
  assert.equal(relativerOrdner({ ablage_pfad: p('D:', 'anders') }, grund), null);
  assert.equal(relativerOrdner(null, grund), null);
});

test('Ordnervorschlag ohne verbotene Zeichen', () => {
  assert.equal(ordnerVorschlag('A/B: "C" AG'), 'A B C AG');
});

test('Onboarding-Stand und Phase', () => {
  const o = { unterlagen: [{ zurueck: true, erhaltenAm: '2026-11-01', gesendetAm: 'x' }, { zurueck: true }, { zurueck: false }] };
  assert.deepEqual(onboardingStand(o), { zurueck: 2, erhalten: 1, offen: 1, gesendet: 1 });
  assert.equal(phaseVon({ aktiv: true, potenziell: true }, [], null), 0);
  assert.equal(phaseVon({ aktiv: true, potenziell: true }, [{ status: 'Versendet' }], null), 1);
  assert.equal(phaseVon({ aktiv: true }, [{ status: 'Angenommen' }], null), 2);
  assert.equal(phaseVon({ aktiv: true }, [{ status: 'Angenommen' }], o), 3);
  assert.equal(phaseVon({ aktiv: true }, [], { abgeschlossen_am: '2026-11-02' }), 4);
  assert.equal(phaseVon({ aktiv: true, potenziell: false }, [], null), 4);
});
