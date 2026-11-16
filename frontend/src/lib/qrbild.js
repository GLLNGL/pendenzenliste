// QR-Code als Bild (PNG-Data-URL) fuer die QR-Rechnung, ohne Ruhezone (der Zahlteil hat Rand).
import { qrMatrix } from './qrcode.js';

async function qrBildUrl(text, modulPx = 6) {
  const m = qrMatrix(text);
  const g = m.length;
  const canvas = document.createElement('canvas');
  canvas.width = g * modulPx;
  canvas.height = g * modulPx;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let y = 0; y < g; y++) for (let x = 0; x < g; x++) if (m[y][x]) ctx.fillRect(x * modulPx, y * modulPx, modulPx, modulPx);
  return canvas.toDataURL('image/png');
}

export { qrBildUrl };
