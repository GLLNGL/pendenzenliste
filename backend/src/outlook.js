// Outlook-Termine (lokal): liest den Standardkalender des auf diesem PC laufenden Outlook ueber
// PowerShell/COM -- nur fuer die Desktop-App (localhost). Keine Anmeldung bei Microsoft noetig.
// Serientermine werden aufgeloest (IncludeRecurrences). Nur lesend.

import { execFile } from 'node:child_process';

const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_MS = 60 * 1000;
const cache = new Map();

// PowerShell-Skript: Zeitraum als Argumente, Ausgabe als JSON (UTF-8). Restrict braucht das
// Datum im Format der Windows-Spracheinstellung -- darum ToString('g') statt festem Format.
const SKRIPT = `
param([string]$von, [string]$bis)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try { $ol = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') }
catch { $ol = New-Object -ComObject Outlook.Application }
$kal = $ol.GetNamespace('MAPI').GetDefaultFolder(9)
$items = $kal.Items
$items.IncludeRecurrences = $true
$items.Sort('[Start]')
$a = [DateTime]::ParseExact($von, 'yyyy-MM-dd', $null)
$b = [DateTime]::ParseExact($bis, 'yyyy-MM-dd', $null)
$filter = "[Start] < '" + $b.ToString('g') + "' AND [End] > '" + $a.ToString('g') + "'"
$liste = New-Object System.Collections.ArrayList
$t = $items.Find($filter)
while ($t -ne $null -and $liste.Count -lt 1000) {
  [void]$liste.Add([ordered]@{
    betreff = [string]$t.Subject
    start = $t.Start.ToString('yyyy-MM-ddTHH:mm:ss')
    ende = $t.End.ToString('yyyy-MM-ddTHH:mm:ss')
    ganztag = [bool]$t.AllDayEvent
    ort = [string]$t.Location
    frei = ($t.BusyStatus -eq 0)
    privat = ($t.Sensitivity -eq 2)
  })
  $t = $items.FindNext()
}
ConvertTo-Json -InputObject @($liste) -Depth 3 -Compress
`;

function powershell(von, bis) {
  const kodiert = Buffer.from(`& {${SKRIPT}} '${von}' '${bis}'`, 'utf16le').toString('base64');
  return new Promise((ok, fehler) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', kodiert],
      { timeout: 30000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) return fehler(new Error((stderr || err.message).toString().split('\n')[0].trim() || 'Outlook nicht erreichbar'));
        try {
          const text = stdout.toString().trim();
          ok(text ? JSON.parse(text) : []);
        } catch {
          fehler(new Error('Antwort von Outlook nicht lesbar'));
        }
      });
  });
}

// Private Termine nur als "Privat" -- der Betreff bleibt in Outlook.
function aufbereiten(t) {
  return t.privat ? { ...t, betreff: 'Privat', ort: '' } : t;
}

async function termine(von, bis) {
  if (!DATUM.test(von ?? '') || !DATUM.test(bis ?? '') || bis <= von) throw new Error('Zeitraum von/bis (JJJJ-MM-TT) fehlt');
  if (process.platform !== 'win32') throw new Error('Outlook ist nur unter Windows verfuegbar');
  const schluessel = `${von}|${bis}`;
  const alt = cache.get(schluessel);
  if (alt && Date.now() - alt.zeit < CACHE_MS) return alt.daten;
  const daten = (await powershell(von, bis)).map(aufbereiten);
  cache.set(schluessel, { zeit: Date.now(), daten });
  return daten;
}

// Nur vom eigenen PC: Anfrage ueber die Loopback-Adresse und mit Host localhost (schuetzt auch
// gegen DNS-Rebinding). Handys im WLAN sehen den Kalender nicht.
function nurLokal(req) {
  const adresse = req.socket?.remoteAddress ?? '';
  const host = String(req.headers.host ?? '').replace(/:\d+$/, '');
  const lokal = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(adresse);
  return lokal && ['localhost', '127.0.0.1', '[::1]'].includes(host);
}

export { termine, nurLokal };
