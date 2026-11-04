# Prompt: Pendenzenliste für ein Treuhandbüro (aktueller Stand v5)

Diese Fassung ergänzt `prompt-pendenzenliste-v4.md` um den **Arbeitsprozess** für die
Pendenzenbearbeitung (Treuhand, mehrere Mandanten, Arbeit mit Abacus), umgesetzt in fünf
Etappen im November 2026. Technik, Hosting (React/Vite auf GitHub Pages, Supabase), Login,
Eingang, Handy-Ansicht und alles andere aus v4 gelten unverändert, soweit hier nichts anderes
steht. v1–v4 bleiben als Historie erhalten.

---

## Der Ablauf, den die App unterstützt

- **Eine Liste für alles:** Jede Pendenz ist ein konkreter **nächster Schritt** (Verb +
  Objekt), kein Thema. Technisch weiterhin das Feld `titel`, in der Oberfläche überall als
  «Nächster Schritt» beschriftet.
- **Triage für jeden Eingang:** Aktion nötig? → unter 2 Minuten (sofort erledigen)? → wartet
  es auf Dritte («Warten auf»)? → mehrere Schritte (Projekt, nur nächster Schritt aktiv)? →
  sonst als Pendenz einplanen.
- **WIP-Limit:** höchstens 3 Pendenzen gleichzeitig «In Arbeit» pro Person.
- **Tagesstart:** fällige Pendenzen ansehen, Top 3 auf «In Arbeit». **Tagesabschluss:** Status
  nachführen, nachfassen.
- **Themenblöcke:** Zahlungen, Lohn, MWST, Abschluss, Debitoren, Admin, Sonstiges.
- **Wochenrückblick** am Freitag mit Checkliste.
- **Wiederkehrende Mandatsarbeiten** entstehen automatisch mit Vorlauf.

## Datenmodell (Ergänzungen gegenüber v4)

Alles in `supabase/schema.sql`, weiterhin handgepflegt und idempotent. Einmalige
Daten-Migrationen laufen nur, wenn die betreffende Spalte noch fehlt (DO-Blöcke mit
`information_schema`-Prüfung) – ein erneutes Ausführen überschreibt keine Daten.

**`pendenzen`**
- `prioritaet`: **A / B / C** (vorher Hoch/Mittel/Tief, migriert Hoch→A, Mittel→B, Tief→C).
  A = harte Frist in ≤ 5 Arbeitstagen oder Mandant blockiert, B = wichtig/nicht dringend,
  C = dringend/wenig Wert (bündeln/delegieren).
- `status`: **Offen / In Arbeit / Warten auf / Später / Erledigt** (vorher «Warte auf Kunde» und
  «Warte intern», beide → «Warten auf»).
- `warten_auf_person` + `wiedervorlage` (= Nachfassdatum): **Pflicht bei «Warten auf»**, als
  Check-Constraint `pendenzen_warten_auf_pflicht` auch in der Datenbank. Beim Verlassen von
  «Warten auf» werden Person, Nachfassdatum und `warte_seit` geleert.
- `harte_frist` (Behörden-/Zahlungsfristen), `aufwand_minuten` (15/30/60/120; das alte
  `aufwand_stunden` bleibt als Referenz stehen), `block`, `reihenfolge` (innerhalb eines
  Projekts), `zuletzt_geaendert_am` (Trigger bei jeder echten Änderung sowie bei neuer
  Fortschrittsnotiz oder Mail), `wochenziel_woche` (Montag der Woche, für die die Pendenz als
  Wochenziel markiert ist).
- `faelligkeit` heisst in der Oberfläche «Frist».

**`mandanten`** (Mandats-Eckdaten, alle optional): `mwst_periode` (Quartal/Semester/keine),
`lohnzahltag`, `zahlungslauf_rhythmus` (woechentlich/14-taeglich/monatlich/keiner),
`abschluss_wunsch_tag` + `abschluss_wunsch_monat`.

**`mitarbeitende`**: `fokusstunden_woche` (Standard 15, in den Einstellungen pro Person änderbar).

**`wiederkehr_regeln`**: `typ` (Zahlungslauf/Lohnlauf/MWST/Mahnlauf/Jahresabschluss/Sonstiges),
`block`, `vorlauf_einheit` (tage/arbeitstage), `checkliste` (JSON-Array von Schritten),
`prioritaet`, `harte_frist`, `aufwand_minuten`; zusätzliche Rhythmen `woechentlich` und
`14-taeglich` mit Fälligkeitstyp `wochentag` (Config `wochentag` 1–5, bei 14-täglich `anker`).

**`wochenrueckblicke`** (neu): ein Eintrag pro Person und Woche (`unique (mitarbeiter_id, woche)`,
`woche` = Montag) mit `checkliste` (JSON `{key: true}`), `liegen_geblieben`, `anders_machen`,
`aktualisiert_am`. Team-RLS wie alle Tabellen.

## Projekt-Logik (ersetzt die Status-Kaskade aus v3/v4)

Postgres-Trigger `pendenzen_projekt_logik` + Funktion `projekt_nachfuehren` (Triggernamen
`trg_pendenzen_status_*` beibehalten):
- Nur der erste noch nicht erledigte Schritt (nach `reihenfolge`) ist «Offen»; weitere «Offen»
  werden «Später». Ist ein Schritt erledigt, wird der nächste «Offen». Bewusst auf «In Arbeit»/
  «Warten auf» gesetzte Schritte bleiben unangetastet.
- Status des Projekt-Kopfs wird abgeleitet: alle erledigt → Erledigt, ein Schritt in Arbeit →
  In Arbeit, sonst Offen. Kopf direkt erledigt → alle Schritte erledigt; Kopf wieder geöffnet →
  Schritte beginnen von vorne.
- Der Trigger reagiert nur noch auf `status`, `reihenfolge`, `uebergeordnete_pendenz_id` –
  **gewöhnliches Speichern der Hauptaufgabe setzt die Schritte nicht mehr zurück** (Eigenheit
  aus v3/v4 entfernt).
- Neue Schritte ohne Reihenfolge werden ans Ende gehängt (Trigger `pendenzen_reihenfolge_vergeben`).
- Test im SQL-Editor: `supabase/test-etappe2.sql` (11 Prüfungen, rollt am Ende alles zurück).

## Erfassung und Regeln (Bearbeiten-Fenster)

- Pflicht: **Mandant** (oder bewusst «Intern (eigenes Büro)» = `mandant_id null`), nächster
  Schritt, Frist, **Aufwand**, Priorität. Projekt-Köpfe brauchen keinen eigenen Aufwand.
  Eingang-Notizen (Handy, Schnellerfassung) sind bis zum Einplanen ausgenommen.
- **Block** wird beim Tippen aus dem nächsten Schritt vorgeschlagen (Stichwörter in
  `lib/vorschlaege.js`, gleich wie die einmalige Migration), solange niemand ihn bewusst wählt.
- **Prioritäts-Vorschlag** «A» bei harter Frist in ≤ 5 Arbeitstagen (Mo–Fr, ohne Feiertage) –
  als Knopf, nicht erzwungen.
- **WIP-Limit** (`lib/wip.js`): beim Setzen auf «In Arbeit» Warnung mit Liste und Rückfrage,
  sobald die zuständige Person schon 3 hat. Ohne Bearbeiter/in wird die Pendenz der
  angemeldeten Person zugewiesen.
- «Warten auf» im Status-Dropdown einer Liste öffnet das Bearbeiten-Fenster, wenn Person/
  Nachfassdatum fehlen.
- Projekt-Schritte im Fenster mit ↑/↓ umsortierbar; Status jedes Schritts sichtbar.
- **Eingang-Triage:** Knöpfe «Keine Aktion» und «Sofort erledigt (< 2 Min.)» legen den Eintrag
  als erledigt ab (mit begründender Fortschrittsnotiz, nichts wird gelöscht); «Warten auf …»,
  «Projekt …», «Einplanen →» öffnen das Bearbeiten-Fenster passend vorbereitet.

## Cockpit (ersetzt die Fälligkeiten-Kategorien aus v4)

Berechnung im Browser (`lib/cockpit.js`, reine Funktion mit Tests) aus allen offenen,
eingeplanten Pendenzen (`api.pendenzen.offene()`); die RPC `cockpit_daten()` wird nicht mehr
verwendet. Projekt-Köpfe zählen nirgends doppelt, es zählt der Schritt.
- **Kennzahlen:** In Arbeit (du) x/3, rot ab 4 · Auslastung nächste Woche (Mo–Fr; eigene und
  nicht zugewiesene Pendenzen nach Bearbeitungstag bzw. Frist, ohne «Warten auf») gegen
  Fokusstunden, Warnung über 70 % · **Block-Filter** zum Abarbeiten am Stück (im Browser gemerkt).
- **Bereiche:** Fällig ≤ 5 Arbeitstage (inkl. überfällig, nach Frist, dann Priorität) · In
  Arbeit · Nachfassen (mit Knopf «Erinnerungs-Mails vorbereiten») · Wochenziele · Heute
  bearbeiten · Unverändert > 14 Tage (nur Offen/In Arbeit, Hinweis «aufteilen, umformulieren
  oder streichen»).
- Kalender und Höhenregler wie in v4.

## Wiederkehrende Mandatsarbeiten (Menüpunkt «Wiederkehrende»)

- Logik in `lib/recurrence.js` (neu geschrieben, Periodenschlüssel der bestehenden Rhythmen
  unverändert; Woche/14 Tage = Datum des Montags) und Standardwerte in `lib/regelVorlagen.js`:
  Zahlungslauf 2 Arbeitstage (Rhythmus aus Mandant), Lohnlauf 7 Tage vor Lohnzahltag, MWST
  60 Tage nach Quartal/Semester mit 3 Wochen Vorlauf, Mahnlauf am 10. ohne Vorlauf,
  Jahresabschluss 7 Wochen vor Wunschtermin im Folgejahr; je mit Beispiel-Checkliste.
- **Erzeugen** (`api.regeln.erzeugen(stichtag)`): legt alle Vorkommen an, die bis zum Stichtag
  erscheinen (Fälligkeit minus Vorlauf), per Upsert auf `regel_id + perioden_schluessel` –
  **keine Duplikate**, auch bei gleichzeitigem Erzeugen. Die Checkliste wird als Projekt-Schritte
  angelegt. **Bereits Überfälliges wird nicht nachträglich erzeugt** (sonst tauchten längst von
  Hand erledigte Arbeiten als überfällig auf).
- **Automatisch:** einmal pro Tag beim ersten Öffnen der App (Stichtag heute, `Layout.jsx`).
  **Knopf** «Wiederkehrende für nächste Woche erzeugen» (Stichtag Freitag nächster Woche).
- Damit ist der offene Punkt 1 aus v4 erledigt – ohne Edge Function/Cron, solange die App
  regelmässig geöffnet wird.

## Nachfassen und Wochenrückblick

- **Erinnerungs-Mails** (`components/NachfassMails.jsx`): Entwurf je «Warten auf» mit fälligem
  Nachfassdatum (Empfänger: Ansprechperson des Mandanten; Text mit Person, Wartedatum, Frist).
  **Nur vorbereitet** – Senden per Klick über die bestehende Mail-Funktion (protokolliert),
  «Im Mailprogramm öffnen» (mailto) oder «Anders nachgefasst». Danach neues Nachfassdatum
  (Standard +7 Tage) und Fortschrittsnotiz.
- **Wochenrückblick** (eigene Ansicht): Checkliste Leeren / Aktualisieren / Planen (10 Punkte,
  Schlüssel in `lib/wochenrueckblick.js`), beginnt jede Woche leer; zu jedem Punkt Hinweise der
  App (Eingang, Unverändertes, Nachfassen, Fristen 4 Wochen, Erzeugen, Wochenziele, Auslastung).
  Wochenziele für die nächste Woche mit ☆ markieren (3–5). Zwei Fragen als Freitext mit Datum,
  frühere Wochen als Verlauf.

## Tests

- Frontend-Unit-Tests: `cd frontend && npm test` (Node `node:test`, reine Funktionen:
  Vorschläge/Arbeitstage, Cockpit, Wiederkehr/Vorlagen, Wochenrückblick).
- SQL: `supabase/pruefung-etappe1.sql` (Migration Etappe 1), `supabase/test-etappe2.sql`
  (Projekt-Logik, rollt zurück).
- Datensicherung vor Schema-Änderungen: `frontend/scripts/backup-supabase.mjs` (Service-Role-Key,
  schreibt nach `backups/`, per `.gitignore` ausgeschlossen).

## Weitere Änderungen / behobene Fehler

- E-Mail der Geschäftsführung wurde im Mandanten-Fenster nie gespeichert (camelCase/snake_case
  vertauscht) – behoben.
- Verschachteltes Formular (Fortschrittsnotiz) im Bearbeiten-Fenster aufgelöst.
- Regel-Vorschau zeigte das abgelaufene Quartal mit noch offener MWST-Frist nicht – behoben.

## Offene Punkte

1. Feiertage bei Arbeitstagen (aktuell Mo–Fr ohne Feiertage).
2. Mandanten löschen/archivieren und Status «Potenziell» (aus v4 übernommen).
3. Einstellungen: Abschnitt «Zugriff vom Handy» (Tailscale/WLAN) bezieht sich noch auf den alten
   lokalen Server und ist überholt – durch die Installationsanleitung (App aus Edge/Chrome
   installieren) ersetzen.
4. Eigene Domain, Docker/Caddy-Unterlagen: wie in v4.
