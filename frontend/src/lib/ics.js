// Erzeugt minimale, aber gueltige iCalendar-Dateien (RFC 5545) fuer eine Pendenz/Teilaufgabe --
// portiert von backend/src/ics.js. Laeuft jetzt im Browser statt auf dem Server: kein
// Download-Endpunkt mehr noetig, die Pendenz-Daten liegen im Frontend ja schon vor.

function escapeText(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function zeitstempelJetzt() {
  return new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function formatLokaleZeit(datum) {
  const jahr = datum.getFullYear();
  const monat = String(datum.getMonth() + 1).padStart(2, '0');
  const tag = String(datum.getDate()).padStart(2, '0');
  const stunde = String(datum.getHours()).padStart(2, '0');
  const minute = String(datum.getMinutes()).padStart(2, '0');
  const sekunde = String(datum.getSeconds()).padStart(2, '0');
  return `${jahr}${monat}${tag}T${stunde}${minute}${sekunde}`;
}

function baueICS({ titel, beschreibung, faelligkeit, uid }) {
  const [jahr, monat, tag] = faelligkeit.split('-').map(Number);
  const jetzt = new Date();
  const start = new Date(jahr, monat - 1, tag, jetzt.getHours(), 0, 0);
  const ende = new Date(start.getTime() + 60 * 60 * 1000);

  const zeilen = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pendenzenliste//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid || `${Date.now()}-${Math.random().toString(36).slice(2)}@pendenzenliste.local`}`,
    `DTSTAMP:${zeitstempelJetzt()}`,
    `DTSTART:${formatLokaleZeit(start)}`,
    `DTEND:${formatLokaleZeit(ende)}`,
    `SUMMARY:${escapeText(titel)}`,
  ];
  if (beschreibung) zeilen.push(`DESCRIPTION:${escapeText(beschreibung)}`);
  zeilen.push('END:VEVENT', 'END:VCALENDAR');

  return zeilen.join('\r\n');
}

function dateinameFuer(titel) {
  const sicher = String(titel).replace(/[^\p{L}\p{N}\- ]/gu, '').trim().replace(/\s+/g, '-');
  return `${sicher || 'Termin'}.ics`;
}

// Baut die .ics-Datei fuer eine Pendenz/Teilaufgabe und stoesst den Browser-Download an.
function ladeICSHerunter(pendenz) {
  const inhalt = baueICS({
    titel: pendenz.titel,
    beschreibung: pendenz.beschreibung,
    faelligkeit: pendenz.faelligkeit,
    uid: `pendenz-${pendenz.id}@pendenzenliste.local`,
  });
  const blob = new Blob([inhalt], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = dateinameFuer(pendenz.titel);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export { baueICS, dateinameFuer, ladeICSHerunter };
