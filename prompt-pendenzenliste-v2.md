# Prompt: Pendenzenliste für ein Treuhandbüro (aktueller Stand)

Kopiere den folgenden Text als Prompt in Claude Code, um die App von Grund auf zu bauen.
Diese Fassung beschreibt den vollständigen Funktionsumfang inkl. Login, Team, Teilaufgaben,
E-Mail-Versand und Kalender-Export.

---

Erstelle mir eine Pendenzenliste-Applikation für die Arbeit als Treuhänder. Ich verwalte ein
Mandantenportfolio mit wiederkehrenden Aufgaben (MWST-Abrechnungen, Lohnläufe, Zahlungsläufe,
Jahresabschlüsse) und einmaligen Pendenzen. Zwei Personen (ich und meine Frau) arbeiten mit
derselben Liste und melden sich je mit ihrer E-Mail-Adresse an.

## Technischer Rahmen

- Web-App, lokal lauffähig, später auf einem einzelnen Server betreibbar.
- Frontend: React mit Vite (JSX, kein TypeScript), react-router-dom, einfaches CSS mit
  CSS-Variablen. Dichtes, nüchternes UI (Arbeitswerkzeug, kein Marketing-Look): kleine
  Abstände, tabellenartige Zeilen, helles Thema.
- Backend: Node.js mit Express, ES-Module.
- Datenbank: SQLite über das eingebaute Modul `node:sqlite` (kein `better-sqlite3` – vermeidet
  native Kompilierung unter Windows). Eine Datei, einfach zu sichern. Pfad über die
  Umgebungsvariable `DB_PFAD` konfigurierbar (Standard: `backend/data/pendenzen.sqlite`).
- Auth: Session-Cookie (httpOnly, sameSite lax, `secure` wenn `NODE_ENV=production`),
  Passwort-Hashing mit `scrypt` aus `node:crypto`, `cookie-parser`.
- E-Mail: `nodemailer`. Konfiguration (`dotenv`) oder über eine Einstellungen-Seite in der App.
- Tests: eingebauter Test-Runner `node --test`.
- Produktivbetrieb: der Backend-Server liefert zusätzlich das gebaute Frontend aus
  (`frontend/dist`), sodass ein einzelner Prozess genügt. Ein `Dockerfile` (mehrstufig) und
  eine `docker-compose.yml` mit Caddy (automatisches HTTPS) liegen bei.
- Sprache der Oberfläche: Deutsch (Schweiz), keine ß-Schreibung. Datumsanzeige TT.MM.JJJJ,
  Eingabefelder ISO (JJJJ-MM-TT).

## Datenmodell

**Mandant**: Name, Kürzel, E-Mail (optional), aktiv/inaktiv, Notizen.

**Mitarbeiter/in (Team)**: Name, E-Mail (optional), Passwort-Hash (optional), aktiv/inaktiv.
Diese Liste ist zugleich die Benutzerverwaltung: Wer einen Passwort-Hash hat, kann sich mit
E-Mail + Passwort anmelden. Wer keinen hat, ist nur ein zuweisbarer Name. Der Passwort-Hash
wird nie ans Frontend gegeben (nur ein Kennzeichen „Login aktiv").

**Sitzung**: Token (Primärschlüssel, liegt als Cookie im Browser), Mitarbeiter-ID,
Erstellungszeitpunkt.

**App-Einstellung**: Schlüssel/Wert-Paare (hält u.a. die SMTP-Zugangsdaten, damit diese in der
Datenbank statt in einer Datei liegen – wichtig für den Serverbetrieb).

**Wiederkehr-Regel**: Titel-Vorlage mit Platzhaltern `{Monat}` (deutscher Monatsname),
`{Quartal}` (Q1–Q4), `{Halbjahr}` (H1/H2), `{Jahr}`; Mandant (optional, es gibt auch interne
Regeln); Rhythmus (`monatlich` / `quartalsweise` / `halbjaehrlich` / `jaehrlich`);
Fälligkeitstyp mit JSON-Konfiguration; Vorlaufzeit in Tagen; aktiv/inaktiv.

Fälligkeitstypen:
- `tag_des_monats` – Konfig `{tag}` (z.B. Lohnlauf am 25.). Tag wird bei kürzeren Monaten auf
  den letzten Tag begrenzt.
- `letzter_tag_des_monats` – Konfig `{}`.
- `tage_nach_periodenende` – Konfig `{tage}` (z.B. MWST: 60 Tage nach Quartalsende).
- `tag_monat_folgejahr` – Konfig `{tag, monat, jahre_offset}` (z.B. Jahresabschluss: 30.06.
  des Folgejahres → `{tag:30, monat:6, jahre_offset:1}`).
- `tage_des_monats_liste` – Konfig `{tage:[15,28]}` – erzeugt mehrere Fälligkeiten pro Monat
  (z.B. Zahlungslauf zweimal monatlich), mit eigenem Periodenschlüssel-Suffix `#0`, `#1`.

**Pendenz**: Titel (konkrete Handlung), Mandant (optional), Bearbeiter/in (optional, verweist
auf Team), Beschreibung, Fälligkeitsdatum, Priorität (Hoch/Mittel/Tief), Status
(Offen / In Arbeit / Warte auf Kunde / Warte intern / Erledigt), Aufwandschätzung in Stunden
(optional), Erstellungsdatum, Erledigungsdatum, Verweis auf Wiederkehr-Regel + Periodenschlüssel
(falls automatisch erzeugt), Verweis auf übergeordnete Pendenz (für Teilaufgaben,
`ON DELETE CASCADE`).

Beim Status „Warte auf Kunde" zusätzlich relevant: Warte-seit-Datum und ein Wiedervorlage-Datum
fürs Nachfassen.

Eindeutigkeitsindex über (Regel-ID, Periodenschlüssel) für die Idempotenz der Generierung
(NULL-Werte manueller Pendenzen sind davon ausgenommen).

## Automatische Generierung aus Wiederkehr-Regeln

Beim Serverstart und danach stündlich (Erkennung eines Tageswechsels) erzeugt die App alle
fälligen Pendenzen aus aktiven Regeln:

- Pro Regel werden die Perioden um „heute" geprüft. Eine Pendenz entsteht, sobald
  `Erscheinungsdatum = Fälligkeit − Vorlaufzeit` erreicht ist und sie noch nicht existiert.
- **Nachtragsfenster 45 Tage**: Perioden, deren Erscheinungsdatum mehr als 45 Tage in der
  Vergangenheit liegt, werden nicht mehr nachgetragen. Das verhindert eine Flut alter Pendenzen
  bei einem späten Erstlauf – besonders bei jährlichen Regeln.
- Idempotent über den Eindeutigkeitsindex (mehrfacher Lauf erzeugt keine Duplikate).

Die Datumslogik (`recurrence.js`) besteht aus reinen Funktionen und rechnet durchgehend in
UTC-Mitternacht, damit Sommerzeit-Wechsel die Tagesarithmetik nicht verfälschen. Enthält u.a.
`getPeriodKey`, `nextPeriodKey`, `previousPeriodKey`, `periodStart`, `periodEnd`,
`berechneFaelligkeiten(rule, periodKey)`, `rendereTitel`, `naechstePendenzen(rule, ab, anzahl)`.

## Authentifizierung

- **Login-Bildschirm**: E-Mail + Passwort. Cookie ~180 Tage gültig, sodass man sich nicht
  ständig neu anmelden muss.
- **„Passwort erstmalig festlegen"**: Existiert für die eingegebene E-Mail bereits ein aktives
  Team-Mitglied ohne Passwort, wird das Passwort gesetzt und die Person angemeldet. Ist die
  Datenbank ganz leer (frische Installation), wird über zusätzliche Eingabe des Namens das
  erste Benutzerkonto angelegt. Sobald mindestens ein Konto existiert, werden fremde Adressen
  hier abgelehnt.
- **Passwort zurücksetzen**: Angemeldete Personen können in der Team-Ansicht das Passwort
  anderer Team-Mitglieder neu setzen (kleines, vertrautes Team). Ein Reset beendet bestehende
  Sitzungen dieser Person.
- Alle `/api/*`-Routen ausser `/api/auth/*` erfordern eine gültige Sitzung. Die statischen
  Frontend-Dateien sind offen; das Frontend prüft nach dem Laden per `/api/auth/ich` und zeigt
  sonst den Login.
- Abmelden-Link in der Seitenleiste, daneben der Name der angemeldeten Person.

## Ansichten

1. **Cockpit** (Startansicht): Überfällige Pendenzen zuoberst (rot), dann heute fällig, dann
   die nächsten 7 Tage. Zusätzlich ein Block „Nachfassen": alle „Warte auf Kunde"-Pendenzen,
   deren Wiedervorlage-Datum erreicht ist.
2. **Alle Pendenzen**: filterbar nach Status, Mandant, Priorität, Zeitraum; sortierbar;
   Volltextsuche über Titel und Beschreibung. Teilaufgaben erscheinen **eingerückt direkt unter
   ihrer Hauptaufgabe** (unabhängig vom eigenen Fälligkeitsdatum), mit Nummerierung `1.1`,
   `1.2` … und einem Pfeil zum **Ein-/Ausklappen**. Ist die Hauptaufgabe wegen eines Filters
   nicht sichtbar, wird die Teilaufgabe als normale Zeile mit Hinweis „↳ Teilaufgabe von: …"
   dargestellt.
3. **Mandanten**: pro Mandant alle offenen Pendenzen, gruppiert nach Status, mit Zähler
   („Müller AG: 4 offen"). CRUD für Mandanten (inkl. E-Mail-Feld).
4. **Wiederkehr-Regeln**: Verwaltung der Regeln, mit Vorschau der nächsten 3 zu erzeugenden
   Pendenzen pro Regel.
5. **Archiv**: erledigte Pendenzen bleiben erhalten (nie löschen), filterbar nach Mandant und
   Erledigungszeitraum – für Rückfragen und Leistungsnachvollzug. Tabellenansicht mit ID-Spalte.
6. **Team**: Mitarbeitende erfassen/bearbeiten (Name, E-Mail, aktiv/inaktiv), Login-Passwort
   setzen/zurücksetzen, Spalte „Login" (🔑 aktiv / kein Login).
7. **Einstellungen**: SMTP-Server, Port, Verschlüsselung (STARTTLS/SSL), Benutzername, Passwort
   (nur setzen, nie anzeigen), Absender-Adresse; Button „Test-E-Mail senden" (an die eigene
   Adresse). Zweiter Abschnitt „Zugriff vom Handy": zeigt die erreichbaren Netzwerk-Adressen
   des Servers (virtuelle Adapter ausgeblendet) und eine kurze Anleitung fürs Home-Bildschirm-
   Symbol.

## Bedienung

- **Schnellerfassung**: von überall per Klick oder Taste `n` eine neue Pendenz erfassen;
  Minimalfelder Titel + Fälligkeit reichen, Rest optional.
- **Ein-Klick-Aktionen** in der Liste ohne Detailansicht: Status per Auswahlfeld ändern,
  Abhaken per Checkbox. Beim Abhaken automatisch Erledigungsdatum setzen; beim Wechsel auf
  „Warte auf Kunde" ohne Angabe automatisch „warte seit heute".
- **Tastatur**: Pfeiltasten bewegen den Fokus in der Liste, Enter öffnet die Detailansicht,
  Leertaste hakt ab bzw. macht das Abhaken rückgängig.
- **Detailansicht (Modal)** einer Pendenz zeigt die ID im Titel („Pendenz 42 bearbeiten"), alle
  Felder inkl. Bearbeiter/in-Auswahl, sowie:
  - **„📅 In Kalender speichern (.ics)"** – lädt einen ganztägigen Termin am Fälligkeitsdatum
    herunter (öffnet per Doppelklick in Outlook/Kalender).
  - **„✉ E-Mail senden"** – Formular mit vorausgefülltem Empfänger (E-Mail der zugewiesenen
    Bearbeiter/in, sonst des Mandanten), Betreff und Text. Checkbox „Als Kalendertermin
    anhängen (.ics)" hängt der E-Mail eine Kalendereinladung bei. Sichtbar nur, wenn SMTP
    eingerichtet ist.
  - **Teilaufgaben-Abschnitt** (nur bei Hauptaufgaben, nicht bei Teilaufgaben): Liste mit
    Abhaken/Löschen und je einem 📅-Kalender-Link, darunter ein Eingabefeld für eine neue
    Teilaufgabe (Titel volle Breite; Datum + „Hinzufügen" in der Zeile darunter). Die
    Hauptaufgabe zeigt in den Listen einen Fortschritts-Badge „2/5".

## E-Mail und Kalender

- SMTP-Konfiguration über die Einstellungen-Seite; Werte landen in der App-Einstellungen-Tabelle
  und werden beim Serverstart in `process.env` übernommen. Ohne Konfiguration zeigen die
  E-Mail-Funktionen einen Hinweis statt Fehler.
- `POST /api/mail/senden` `{an, betreff, text, kalender?}` – versendet per nodemailer; ist
  `kalender` (`{titel, faelligkeit, beschreibung}`) gesetzt, wird eine `.ics`-Datei angehängt.
- `POST /api/mail/test` – schickt eine Testnachricht an die eigene Absenderadresse.
- `GET /api/pendenzen/:id/ics` – liefert die `.ics`-Datei zum Download (Content-Disposition
  attachment, Dateiname aus dem Titel).
- ICS: minimales, gültiges VCALENDAR/VEVENT (RFC 5545), ganztägiger Termin
  (`DTSTART;VALUE=DATE`), Sonderzeichen escaped.

## Startdaten und Skripte

- `npm run seed` – leert die Datenbank und füllt sie mit Demo-Daten: 4 Beispielmandanten;
  Regeln für MWST (quartalsweise, 60 Tage nach Quartalsende, Vorlauf 30), Lohnlauf (monatlich,
  25., Vorlauf 7), Zahlungslauf (zweimal monatlich, 15./28.), Jahresabschluss (jährlich,
  30.06. Folgejahr, Vorlauf 120); Beispiel-Pendenzen in verschiedenen Status inkl. einer
  überfälligen und einer „Warte auf Kunde"; eine Hauptaufgabe mit drei Teilaufgaben; plus die
  automatisch generierten Pendenzen.
- `npm run leeren` – löscht alle Daten (Mandanten, Regeln, Pendenzen), ohne Demo-Daten
  einzufügen. Team/Logins bleiben.
- Nicht-destruktive Schema-Migrationen beim Öffnen der Datenbank: fehlende Spalten/Tabellen
  werden ergänzt, bestehende Daten bleiben unangetastet.

## Vorgehen

Arbeite in dieser Reihenfolge und zeige nach jedem Schritt kurz den Stand:

1. Projektstruktur, Datenbankschema, Seed-Daten, `recurrence.js` mit Unit-Tests (Quartals- und
   Jahreswechsel, Monatsenden inkl. Schaltjahr, „letzter Tag des Monats" im Februar).
2. Backend-API: Auth (Login, Sitzungen, Passwort festlegen, Middleware), CRUD für Mandanten,
   Team, Regeln, Pendenzen; Generierungslogik mit Tests für Idempotenz und Nachtragsfenster;
   E-Mail- und ICS-Routen.
3. Frontend: AuthGate + Login + Ersteinrichtung, dann die Ansichten in der Reihenfolge
   Cockpit → Alle Pendenzen → Mandanten → Regeln → Archiv → Team → Einstellungen.
4. Feinschliff: Tastenkürzel, Schnellerfassung, überfällig-Markierung, eingerückte/einklappbare
   Teilaufgaben mit `1.1`-Nummerierung, App-Icon (Favicon + PWA-Icons + Web-App-Manifest),
   Single-Prozess-Auslieferung des Frontends, `Dockerfile` + `docker-compose.yml` + `Caddyfile`.

Schreibe für die Wiederkehr-Logik und die Authentifizierung Unit-Tests.
