// Erzeugt minimale, aber gueltige iCalendar-Dateien (RFC 5545) fuer eine Pendenz/Teilaufgabe --
// als einstuendiger Termin am Faelligkeitsdatum, beginnend zur aktuellen vollen Stunde (nicht
// ganztaegig, damit er im Kalender an einer echten, planbaren Uhrzeit auftaucht). Wird sowohl
// fuer den Direkt-Download als auch als E-Mail-Anhang verwendet, damit Outlook die Pendenz
// direkt in den Kalender uebernehmen kann.

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

// Lokale (nicht UTC) Zeit im ICS-Format YYYYMMDDTHHMMSS -- ohne "Z" und ohne TZID, damit der
// Kalender die Uhrzeit unveraendert in der jeweils eigenen Zeitzone uebernimmt.
function formatLokaleZeit(datum) {
  const jahr = datum.getFullYear();
  const monat = String(datum.getMonth() + 1).padStart(2, '0');
  const tag = String(datum.getDate()).padStart(2, '0');
  const stunde = String(datum.getHours()).padStart(2, '0');
  const minute = String(datum.getMinutes()).padStart(2, '0');
  const sekunde = String(datum.getSeconds()).padStart(2, '0');
  return `${jahr}${monat}${tag}T${stunde}${minute}${sekunde}`;
}

/**
 * Baut den Inhalt einer .ics-Datei: ein einstuendiger Termin am Faelligkeitsdatum, beginnend
 * zur aktuellen vollen Stunde. Die Minute/Sekunde des Erstellungszeitpunkts wird bewusst auf
 * die volle Stunde abgerundet -- ein Ueberlauf ueber Mitternacht (z.B. 23 Uhr -> 00 Uhr am
 * naechsten Tag) wird durch normale Date-Arithmetik automatisch korrekt aufgeloest.
 */
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

export { baueICS, dateinameFuer };
