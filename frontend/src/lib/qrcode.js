// QR-Code-Encoder (ISO/IEC 18004) fuer die QR-Rechnung: Byte-Modus (UTF-8), Fehlerkorrektur
// M (Vorgabe Swiss QR Code), kleinste passende Version, Maske nach Strafpunkten. Liefert die
// Modulmatrix (true = dunkel). Ohne Abhaengigkeiten.

const EC_M = 0; // Index in den Tabellen
// Anzahl Fehlerkorrektur-Codewoerter pro Block und Anzahl Bloecke, Fehlerkorrektur M, Version 1..40.
const ECC_PRO_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const BLOECKE_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];

function rohModule(version) {
  let n = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const anzahlAlign = Math.floor(version / 7) + 2;
    n -= (25 * anzahlAlign - 10) * anzahlAlign - 55;
    if (version >= 7) n -= 36;
  }
  return n;
}
const datenCodewoerter = (version) => Math.floor(rohModule(version) / 8) - ECC_PRO_BLOCK_M[version] * BLOECKE_M[version];

// --- Reed-Solomon ueber GF(256), Polynom 0x11D ---
function gfMal(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function rsGenerator(grad) {
  const r = new Array(grad).fill(0);
  r[grad - 1] = 1;
  let wurzel = 1;
  for (let i = 0; i < grad; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMal(r[j], wurzel);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    wurzel = gfMal(wurzel, 0x02);
  }
  return r;
}
function rsRest(daten, generator) {
  const r = new Array(generator.length).fill(0);
  for (const b of daten) {
    const faktor = b ^ r.shift();
    r.push(0);
    generator.forEach((g, i) => { r[i] ^= gfMal(g, faktor); });
  }
  return r;
}

function utf8(text) {
  return [...new TextEncoder().encode(text)];
}

// Datenbits -> Codewoerter mit Fuellung.
function codewoerter(bytes, version) {
  const bits = [];
  const anhaengen = (wert, laenge) => { for (let i = laenge - 1; i >= 0; i--) bits.push((wert >>> i) & 1); };
  anhaengen(0b0100, 4); // Byte-Modus
  anhaengen(bytes.length, version <= 9 ? 8 : 16);
  bytes.forEach((b) => anhaengen(b, 8));
  const kapazitaet = datenCodewoerter(version) * 8;
  anhaengen(0, Math.min(4, kapazitaet - bits.length));
  anhaengen(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < kapazitaet; pad ^= 0xec ^ 0x11) anhaengen(pad, 8);
  const woerter = [];
  for (let i = 0; i < bits.length; i += 8) woerter.push(bits.slice(i, i + 8).reduce((s, x) => (s << 1) | x, 0));
  return woerter;
}

// Bloecke bilden, Fehlerkorrektur anhaengen, verschraenken.
function mitFehlerkorrektur(daten, version) {
  const anzahlBloecke = BLOECKE_M[version];
  const eccLaenge = ECC_PRO_BLOCK_M[version];
  const roh = Math.floor(rohModule(version) / 8);
  const kurzeBloecke = anzahlBloecke - (roh % anzahlBloecke);
  const kurzeLaenge = Math.floor(roh / anzahlBloecke);
  const generator = rsGenerator(eccLaenge);
  const bloecke = [];
  for (let i = 0, k = 0; i < anzahlBloecke; i++) {
    const laenge = kurzeLaenge - eccLaenge + (i < kurzeBloecke ? 0 : 1);
    const dat = daten.slice(k, k + laenge);
    k += laenge;
    const ecc = rsRest(dat, generator);
    if (i < kurzeBloecke) dat.push(0); // Platzhalter, wird beim Verschraenken uebersprungen
    bloecke.push([...dat, ...ecc]);
  }
  const ergebnis = [];
  for (let i = 0; i < bloecke[0].length; i++) {
    bloecke.forEach((b, j) => { if (i !== kurzeLaenge - eccLaenge || j >= kurzeBloecke) ergebnis.push(b[i]); });
  }
  return ergebnis;
}

function alignPositionen(version) {
  if (version === 1) return [];
  const anzahl = Math.floor(version / 7) + 2;
  const schritt = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (anzahl * 2 - 2)) * 2;
  const pos = [6];
  for (let p = version * 4 + 10; pos.length < anzahl; p -= schritt) pos.splice(1, 0, p);
  return pos;
}

function matrixBauen(version, daten, maske) {
  const g = version * 4 + 17;
  const m = Array.from({ length: g }, () => new Array(g).fill(false));
  const fest = Array.from({ length: g }, () => new Array(g).fill(false));
  const setze = (x, y, dunkel) => { m[y][x] = dunkel; fest[y][x] = true; };

  for (let i = 0; i < g; i++) { setze(6, i, i % 2 === 0); setze(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx; const y = cy + dy;
        if (x >= 0 && x < g && y >= 0 && y < g) setze(x, y, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3); finder(g - 4, 3); finder(3, g - 4);
  const al = alignPositionen(version);
  al.forEach((ay, i) => al.forEach((ax, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setze(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  formatBits(m, fest, g, maske, setze);
  if (version >= 7) {
    let rest = version;
    for (let i = 0; i < 12; i++) rest = (rest << 1) ^ ((rest >>> 11) * 0x1f25);
    const bits = (version << 12) | rest;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = g - 11 + (i % 3); const b = Math.floor(i / 3);
      setze(a, b, bit); setze(b, a, bit);
    }
  }
  // Daten im Zickzack einsetzen.
  let i = 0;
  for (let rechts = g - 1; rechts >= 1; rechts -= 2) {
    if (rechts === 6) rechts = 5;
    for (let vert = 0; vert < g; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = rechts - j;
        const aufwaerts = ((rechts + 1) & 2) === 0;
        const y = aufwaerts ? g - 1 - vert : vert;
        if (!fest[y][x] && i < daten.length * 8) {
          m[y][x] = ((daten[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
    }
  }
  // Maske anwenden.
  for (let y = 0; y < g; y++) {
    for (let x = 0; x < g; x++) {
      if (fest[y][x]) continue;
      let invert;
      switch (maske) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      }
      if (invert) m[y][x] = !m[y][x];
    }
  }
  return m;
}

// Formatinformation (Fehlerkorrektur M = 0b00) mit BCH-Code und Maske.
function formatBits(m, fest, g, maske, setze) {
  const daten = (EC_M << 3) | maske;
  let rest = daten;
  for (let i = 0; i < 10; i++) rest = (rest << 1) ^ ((rest >>> 9) * 0x537);
  const bits = ((daten << 10) | rest) ^ 0x5412;
  const bit = (i) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) setze(8, i, bit(i));
  setze(8, 7, bit(6)); setze(8, 8, bit(7)); setze(7, 8, bit(8));
  for (let i = 9; i < 15; i++) setze(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) setze(g - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) setze(8, g - 15 + i, bit(i));
  setze(8, g - 8, true); // dunkles Modul
}

// Strafpunkte (ISO 18004, 7.8.3) zur Wahl der Maske.
function strafpunkte(m) {
  const g = m.length;
  let p = 0;
  const reihe = (get) => {
    for (let a = 0; a < g; a++) {
      let lauf = 1;
      for (let b = 1; b < g; b++) {
        if (get(a, b) === get(a, b - 1)) { lauf++; if (lauf === 5) p += 3; else if (lauf > 5) p += 1; } else lauf = 1;
      }
      for (let b = 0; b + 10 < g; b++) {
        const muster = [true, false, true, true, true, false, true];
        const pass = (off) => muster.every((v, k) => get(a, b + off + k) === v);
        const weiss4 = (off) => [0, 1, 2, 3].every((k) => !get(a, b + off + k));
        if ((pass(0) && weiss4(7)) || (weiss4(0) && pass(4))) p += 40;
      }
    }
  };
  reihe((y, x) => m[y][x]);
  reihe((x, y) => m[y][x]);
  for (let y = 0; y + 1 < g; y++) {
    for (let x = 0; x + 1 < g; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
    }
  }
  const dunkel = m.reduce((s, r) => s + r.filter(Boolean).length, 0);
  const anteil = (dunkel * 100) / (g * g);
  p += Math.floor(Math.abs(anteil - 50) / 5) * 10;
  return p;
}

/** QR-Code als Matrix (Array von Zeilen, true = dunkel). */
function qrMatrix(text) {
  const bytes = utf8(text);
  let version = 1;
  while (version <= 40 && 4 + (version <= 9 ? 8 : 16) + bytes.length * 8 > datenCodewoerter(version) * 8) version++;
  if (version > 40) throw new Error('Text zu lang für einen QR-Code.');
  const daten = mitFehlerkorrektur(codewoerter(bytes, version), version);
  let beste = null;
  let besteP = Infinity;
  for (let maske = 0; maske < 8; maske++) {
    const m = matrixBauen(version, daten, maske);
    const p = strafpunkte(m);
    if (p < besteP) { beste = m; besteP = p; }
  }
  return beste;
}

export { qrMatrix, rsGenerator, rsRest, gfMal, datenCodewoerter, alignPositionen };
