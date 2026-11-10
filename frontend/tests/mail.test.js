import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_SIGNATUR, LOGO_CID, grussEntfernen, mailAufbereiten, adressenListe } from '../src/lib/mail.js';

test('Schlussgruss wird entfernt (die Signatur bringt ihn mit)', () => {
  assert.equal(grussEntfernen('Guten Tag\n\nIm Anhang die Offerte.\n\nFreundliche Grüsse\nAngelo Gallo\nestcontrolling GmbH'), 'Guten Tag\n\nIm Anhang die Offerte.');
  assert.equal(grussEntfernen('Hallo\nBeste Grüsse, Angelo'), 'Hallo');
  assert.equal(grussEntfernen('Nur Text ohne Gruss\n\n'), 'Nur Text ohne Gruss');
  // Ein Gruss weit oben im Text bleibt stehen.
  assert.equal(grussEntfernen('Freundliche Grüsse vorab\n1\n2\n3\n4\n5\n6\n7\n8\n9'), 'Freundliche Grüsse vorab\n1\n2\n3\n4\n5\n6\n7\n8\n9');
});

test('Mail mit Arial 10, Signatur und Logo', () => {
  const m = mailAufbereiten('Guten Tag <Kunde>\n\nFreundliche Grüsse\nAngelo');
  assert.equal(m.text, `Guten Tag <Kunde>\n\n${STANDARD_SIGNATUR}`);
  assert.match(m.html, /font-family:Arial,Helvetica,sans-serif;font-size:10pt/);
  assert.match(m.html, /Guten Tag &lt;Kunde&gt;/);
  assert.match(m.html, /<a href="mailto:info@estcontrolling.ch"/);
  assert.match(m.html, /<a href="http:\/\/www.estcontrolling.ch\/"/);
  assert.ok(m.html.includes(`cid:${LOGO_CID}`));
  assert.equal((m.html.match(/Freundliche Grüsse/g) || []).length, 1);
  assert.ok(!mailAufbereiten('x', 'Gruss', { mitLogo: false }).html.includes('cid:'));
});

test('CC/BCC-Adressen', () => {
  assert.deepEqual(adressenListe('a@b.ch; c@d.ch, e@f.ch'), ['a@b.ch', 'c@d.ch', 'e@f.ch']);
  assert.deepEqual(adressenListe(''), []);
  assert.throws(() => adressenListe('a@b.ch; kein-mail'), /kein-mail/);
});
