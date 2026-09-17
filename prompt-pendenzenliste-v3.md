# Prompt: Pendenzenliste für ein Treuhandbüro (aktueller Stand v3)

Kopiere den folgenden Text als Prompt in Claude Code, um die App von Grund auf zu bauen.
Diese Fassung ersetzt `prompt-pendenzenliste-v2.md` und ergänzt sie um: das dreispaltige
Cockpit-/Listen-Layout mit Vorschau-Spalte, den Fälligkeitskalender, die Status-Verknüpfung
zwischen Haupt- und Teilaufgabe, das E-Mail-Protokoll, Fortschrittsnotizen, zwei E-Mail-Felder
pro Mandant sowie eine automatische Bildschirm-Skalierung (wie Outlook: gleiches Layout, nur
kleiner) statt eines Spalten-Umbruchs, mit horizontalem Scrollen als Ausweichlösung und
Tooltips für abgeschnittene Titel. v1/v2 bleiben als Historie erhalten.

---

Erstelle mir eine Pendenzenliste-Applikation für die Arbeit als Treuhänder. Ich verwalte ein
Mandantenportfolio mit wiederkehrenden Aufgaben (MWST-Abrechnungen, Lohnläufe, Zahlungsläufe,
Jahresabschlüsse) und einmaligen Pendenzen. Zwei Personen (ich und meine Frau) arbeiten mit
derselben Liste und melden sich je mit ihrer E-Mail-Adresse an.

## Technischer Rahmen

- Web-App, lokal lauffähig, später auf einem einzelnen Server oder einer Synology-NAS
  betreibbar (Fernzugriff z.B. über Tailscale).
- Frontend: React mit Vite (JSX, kein TypeScript), react-router-dom, einfaches CSS mit
  CSS-Variablen. Dichtes, nüchternes UI (Arbeitswerkzeug, kein Marketing-Look): kleine
  Abstände, tabellenartige Zeilen, helles Thema. Responsiv (siehe eigener Abschnitt unten) --
  die App wird auch als installierte PWA auf dem iPhone genutzt.
- Backend: Node.js mit Express, ES-Module.
- Datenbank: SQLite über das eingebaute Modul `node:sqlite` (kein `better-sqlite3` -- vermeidet
  native Kompilierung unter Windows). Eine Datei, einfach zu sichern. Pfad über die
  Umgebungsvariable `DB_PFAD` konfigurierbar (Standard: `backend/data/pendenzen.sqlite`).
  Nicht-destruktive Schema-Migrationen beim Öffnen (fehlende Spalten/Tabellen ergänzen, nie
  bestehende Daten anfassen).
- Auth: Session-Cookie (httpOnly, sameSite lax, `secure` wenn `NODE_ENV=production`),
  Passwort-Hashing mit `scrypt` aus `node:crypto`, `cookie-parser`.
- E-Mail: `nodemailer`. Konfiguration (`dotenv`) oder über eine Einstellungen-Seite in der App.
- Tests: eingebauter Test-Runner `node --test`. Fachliche Logik (Datumsarithmetik,
  Status-Verknüpfung Haupt-/Teilaufgabe, Auth) über direkt exportierte, mit einer
  In-Memory-SQLite-DB (`:memory:` + Schema) getestete Funktionen abdecken.
- Produktivbetrieb: der Backend-Server liefert zusätzlich das gebaute Frontend aus
  (`frontend/dist`), sodass ein einzelner Prozess genügt. **Wichtig:** `npm start` beobachtet
  keine Dateiänderungen -- nach Backend-Änderungen muss der Prozess neu gestartet werden, sonst
  laufen Frontend (neu gebaut) und Backend (alter Code) auseinander. Ein `Dockerfile`
  (mehrstufig) und eine `docker-compose.yml` mit Caddy (automatisches HTTPS) liegen bei.
- Sprache der Oberfläche: Deutsch (Schweiz), keine ß-Schreibung. Datumsanzeige TT.MM.JJJJ,
  Zeitstempel TT.MM.JJJJ HH:MM (lokale Zeitzone), Eingabefelder ISO (JJJJ-MM-TT).

## Datenmodell

**Mandant**: Name, Kürzel, aktiv/inaktiv, Notizen, **zwei E-Mail-Felder**:
- `email` -- Ansprechpartner/in für die laufende Kommunikation, wird beim E-Mail-Versand als
  Schnellauswahl-Option angeboten.
- `geschaeftsfuehrung_email` -- Geschäftsführung/Inhaber, optional, nur für grundsätzliche
  Fragen; wird nie automatisch vorausgefüllt, nur als weitere Schnellauswahl-Option.

**Mitarbeiter/in (Team)**: Name, E-Mail (optional), Passwort-Hash (optional), aktiv/inaktiv.
Diese Liste ist zugleich die Benutzerverwaltung: Wer einen Passwort-Hash hat, kann sich mit
E-Mail + Passwort anmelden. Wer keinen hat, ist nur ein zuweisbarer Name. Der Passwort-Hash
wird nie ans Frontend gegeben (nur ein Kennzeichen „Login aktiv").

**Sitzung**: Token (Primärschlüssel, liegt als Cookie im Browser), Mitarbeiter-ID,
Erstellungszeitpunkt.

**App-Einstellung**: Schlüssel/Wert-Paare (hält u.a. die SMTP-Zugangsdaten, damit diese in der
Datenbank statt in einer Datei liegen -- wichtig für den Serverbetrieb).

**Wiederkehr-Regel**: Titel-Vorlage mit Platzhaltern `{Monat}` (deutscher Monatsname),
`{Quartal}` (Q1–Q4), `{Halbjahr}` (H1/H2), `{Jahr}`; Mandant (optional, es gibt auch interne
Regeln); Rhythmus (`monatlich` / `quartalsweise` / `halbjaehrlich` / `jaehrlich`);
Fälligkeitstyp mit JSON-Konfiguration; Vorlaufzeit in Tagen; aktiv/inaktiv.

Fälligkeitstypen:
- `tag_des_monats` -- Konfig `{tag}` (z.B. Lohnlauf am 25.). Tag wird bei kürzeren Monaten auf
  den letzten Tag begrenzt.
- `letzter_tag_des_monats` -- Konfig `{}`.
- `tage_nach_periodenende` -- Konfig `{tage}` (z.B. MWST: 60 Tage nach Quartalsende).
- `tag_monat_folgejahr` -- Konfig `{tag, monat, jahre_offset}` (z.B. Jahresabschluss: 30.06.
  des Folgejahres → `{tag:30, monat:6, jahre_offset:1}`).
- `tage_des_monats_liste` -- Konfig `{tage:[15,28]}` -- erzeugt mehrere Fälligkeiten pro Monat
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

**Protokoll gesendeter E-Mails** (`pendenz_emails`): pro Pendenz eine Zeile je Versand --
Empfänger, Betreff, Zeitstempel. Wird von der Versand-Route automatisch geschrieben, nie
manuell bearbeitet.

**Fortschrittsnotizen** (`pendenz_notizen`): Freitext-Einträge pro Pendenz mit Zeitstempel und
Ersteller (verweist auf Team, nullable), von Hand erfasst und löschbar -- dokumentiert, was an
einer Pendenz bereits unternommen wurde (unabhängig von der festen Beschreibung).

## Automatische Generierung aus Wiederkehr-Regeln

Beim Serverstart und danach stündlich (Erkennung eines Tageswechsels) erzeugt die App alle
fälligen Pendenzen aus aktiven Regeln:

- Pro Regel werden die Perioden um „heute" geprüft. Eine Pendenz entsteht, sobald
  `Erscheinungsdatum = Fälligkeit − Vorlaufzeit` erreicht ist und sie noch nicht existiert.
- **Nachtragsfenster 45 Tage**: Perioden, deren Erscheinungsdatum mehr als 45 Tage in der
  Vergangenheit liegt, werden nicht mehr nachgetragen. Das verhindert eine Flut alter Pendenzen
  bei einem späten Erstlauf -- besonders bei jährlichen Regeln.
- Idempotent über den Eindeutigkeitsindex (mehrfacher Lauf erzeugt keine Duplikate).

Die Datumslogik (`recurrence.js`) besteht aus reinen Funktionen und rechnet durchgehend in
UTC-Mitternacht, damit Sommerzeit-Wechsel die Tagesarithmetik nicht verfälschen. Enthält u.a.
`getPeriodKey`, `nextPeriodKey`, `previousPeriodKey`, `periodStart`, `periodEnd`,
`berechneFaelligkeiten(rule, periodKey)`, `rendereTitel`, `naechstePendenzen(rule, ab, anzahl)`.

## Status-Automatik zwischen Haupt- und Teilaufgabe

Der Status einer Hauptaufgabe und ihrer Teilaufgaben bleibt in beide Richtungen verknüpft --
gilt bei jeder Statusänderung, egal ob per Checkbox, Status-Dropdown in einer Liste oder im
Bearbeiten-Fenster, und auch beim Hinzufügen/Löschen einer Teilaufgabe:

- **Bottom-up (Teilaufgabe → Hauptaufgabe)**: Der Status der Hauptaufgabe wird aus ihren
  Teilaufgaben abgeleitet -- sind alle offen, ist die Hauptaufgabe „Offen"; sind alle erledigt,
  ist sie „Erledigt"; alles dazwischen (mindestens eine Teilaufgabe nicht mehr offen, aber
  nicht alle erledigt) ergibt „In Arbeit".
- **Top-down (Hauptaufgabe → Teilaufgaben)**: Wird der Status der Hauptaufgabe manuell
  gesetzt, kaskadiert das auf alle Teilaufgaben -- „Erledigt" setzt alle Teilaufgaben auf
  erledigt, jeder andere Status (Offen, In Arbeit, Warte auf Kunde/intern) setzt alle
  Teilaufgaben zurück auf offen.
- Beide Richtungen sind eigenständige, einmalige Aktualisierungen -- keine ruft die jeweils
  andere erneut auf, damit keine Endlosschleife entstehen kann.
- Das Hinzufügen einer neuen (offenen) Teilaufgabe kann eine bereits erledigte Hauptaufgabe
  wieder öffnen; das Löschen der letzten offenen Teilaufgabe kann eine Hauptaufgabe wieder auf
  „Erledigt" bringen.

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

## Tabellen-Design (Pendenzenlisten allgemein)

Jede Liste von Pendenzen (Cockpit, Alle Pendenzen, Mandanten, Kalender-Tagesliste) ist eine
echte HTML-`<table>` mit Kopfzeile „Titel / Mandant · Bearbeiter/in / Status / Fällig" (feste
Spaltenbreiten über `table-layout: fixed`, damit die Kopfzeile auch bei leerem Ergebnis stehen
bleibt statt durch einen Hinweistext ersetzt zu werden). Priorität wird nicht als Badge/Chip
geführt, sondern als schmaler Farbstreifen (3px) an der ersten Zelle -- rot = Hoch, ockerorange
= Mittel, grau = Tief; fällt bei vielen Zeilen sofort auf, ohne mit Status und Mandant um
Aufmerksamkeit zu konkurrieren.

Teilaufgaben erscheinen eingerückt direkt unter ihrer Hauptaufgabe (an einer Leitlinie, mit
gestrichelter Trennlinie), nummeriert `1.1`, `1.2` …, mit Pfeil zum Ein-/Ausklappen und einem
Mini-Fortschrittsbalken an der Hauptaufgabe (`2/5`). Ist die Hauptaufgabe wegen eines Filters
nicht in derselben Liste sichtbar, erscheint die Teilaufgabe als normale Zeile mit Hinweis
„↳ Teilaufgabe von: …". Teilaufgaben-Zeilen tragen keinen eigenen Farbstreifen (Priorität
ergibt sich aus der Hauptaufgabe) und keinen Status-Dropdown, sondern nur den Status als
kleinen Text -- immer sichtbar, auch „Offen".

Wurde für eine Pendenz schon einmal eine E-Mail versendet, erscheint neben dem Titel ein
kleines ✉-Symbol (Tooltip: Datum, ggf. Anzahl). Zeilen sind komplett anklickbar
(`cursor: pointer`), Klick öffnet je nach Kontext entweder direkt das Bearbeiten-Fenster oder
(siehe unten) die Vorschau-Spalte.

## Dreispaltiges Layout: Liste + Vorschau

Cockpit und „Alle Pendenzen" nutzen ein gemeinsames Muster: eine Karte mit den Pendenzen links/
in der Mitte, und ganz rechts eine **Vorschau-Spalte** (fix ~420px breit, Karte insgesamt bis
1500px). Klick auf eine Zeile öffnet **nicht** sofort das Bearbeiten-Fenster, sondern zeigt die
Pendenz rechts in der Vorschau (die angeklickte Zeile bleibt dezent hervorgehoben); erst ein
Klick in der Vorschau selbst öffnet das bekannte Bearbeiten-Pop-up. So bleibt die Liste beim
Durchklicken mehrerer Pendenzen stabil sichtbar.

**Cockpit** (Startansicht), zwei Karten:

1. **„Fälligkeiten"**: links eine schmale Kategorien-Spalte (wie Ordner in einem Mail-Programm)
   -- Überfällig, Heute fällig, Morgen fällig, Nachfassen (Wiedervorlage fällig), je mit
   Anzahl-Pille (Überfällig/Nachfassen zusätzlich farblich markiert). In der Mitte die Liste der
   gewählten Kategorie, rechts die Vorschau. Beim ersten Laden ist automatisch die erste
   nicht-leere Kategorie aktiv.
2. **„Weitere Pendenzen"** (Fälligkeitskalender): links ein Monatskalender, in der Mitte die
   Pendenzen des angeklickten Tages, rechts die Vorschau. Der Kalender zeigt immer volle Wochen
   (Mo-So, auch mit Tagen aus Vor-/Folgemonat), mit einer schmalen Kalenderwochen-Spalte (klein,
   kursiv, ohne eigene Spaltenüberschrift -- wie im iPhone-Kalender). Tage sind als Kreise
   dargestellt: heute = ausgefüllter Kreis, ausgewählt = Ring, Tage mit mindestens einer
   fälligen offenen Pendenz fett + kleiner Punkt darunter. Navigation ‹ Monat Jahr › plus
   „Heute"-Button. Ersetzt eine frühere „Nächste 7 Tage"-Liste -- beliebig weit in die Zukunft
   navigierbar.

**Alle Pendenzen**: Filterleiste (Suche, Status, Mandant, Priorität, Zeitraum, Sortierung)
unverändert oben; darunter dasselbe Liste-plus-Vorschau-Layout wie im Cockpit (ohne
Kategorien-Spalte, dafür mit Checkbox-Spalte -- Status lässt sich hier weiterhin direkt per
Checkbox abhaken). Status-Filter default „Offene Pendenzen" (erledigte ausgeblendet, aber über
den Filter oder „Alle inkl. erledigte" erreichbar).

**Mandanten**: unverändert eigene Ansicht (pro Mandant alle offenen Pendenzen, gruppiert nach
Status) -- nutzt die gleiche Tabellen-Komponente, aber ohne Vorschau-Spalte.

**Inhalt der Vorschau-Spalte** (von oben nach unten):

1. Kopf: Prioritäts-Badge + Status-Text, Titel, Mandant/Bearbeiter/in, Fällig/Wiedervorlage/
   Aufwand.
2. Überschrift **„Bemerkungen"** + die Beschreibung der Pendenz (oder „Keine Beschreibung
   hinterlegt.").
3. Hinweis „Klicken für alle Details →" (schliesst den anklickbaren Bereich ab).
4. Nur bei Hauptaufgaben: Überschrift **„Teilaufgaben"** (mit „x/y erledigt") -- eigene,
   nicht in den Klick-Bereich der Hauptaufgabe eingeschlossene Liste; Klick auf eine
   Teilaufgabe öffnet direkt deren eigenes Bearbeiten-Fenster, die Checkbox hakt sie direkt ab.
5. Überschrift **„E-Mails"**: grüne Liste aller bisherigen Versendungen dieser Pendenz (✔
   Datum, Empfänger -- ohne Betreff, der würde den Titel nur wiederholen), sonst „Keine Daten."
6. Überschrift **„Fortschritt"**: die Fortschrittsnotizen dieser Pendenz (Datum, Ersteller,
   Text), sonst „Keine Daten." -- read-only, Erfassen/Löschen nur im Bearbeiten-Fenster.

Überschriften (Bemerkungen/Teilaufgaben/E-Mails/Fortschritt) sind dunkel/fett und in
Grossbuchstaben gesetzt, der Fliesstext darunter bewusst gedämpfter (grau) -- klare optische
Hierarchie. Alle Abschnitte reagieren live auf Änderungen irgendwo in der App (Ereignis-Bus),
nicht nur auf einen Wechsel der angezeigten Pendenz -- sonst bliebe z.B. eine über ihr eigenes
Fenster geänderte Teilaufgabe hier veraltet stehen.

Abgeschnittene (durch `text-overflow: ellipsis` gekürzte) Titel -- in Tabellenzeilen wie in
Teilaufgaben-Listen -- tragen ein natives `title`-Attribut mit dem vollständigen Text, sodass
ein Mauszeiger-Tooltip beim Hovern den ganzen Titel zeigt.

## Weitere Ansichten

- **Wiederkehr-Regeln**: Verwaltung der Regeln, mit Vorschau der nächsten 3 zu erzeugenden
  Pendenzen pro Regel.
- **Archiv**: erledigte Pendenzen bleiben erhalten (nie löschen), filterbar nach Mandant und
  Erledigungszeitraum -- für Rückfragen und Leistungsnachvollzug. Tabellenansicht mit ID-Spalte.
- **Team**: Mitarbeitende erfassen/bearbeiten (Name, E-Mail, aktiv/inaktiv), Login-Passwort
  setzen/zurücksetzen, Spalte „Login" (🔑 aktiv / kein Login).
- **Einstellungen**: SMTP-Server, Port, Verschlüsselung (STARTTLS/SSL), Benutzername, Passwort
  (nur setzen, nie anzeigen), Absender-Adresse; Button „Test-E-Mail senden" (an die eigene
  Adresse). Zweiter Abschnitt „Zugriff vom Handy": zeigt die im lokalen Netz erreichbaren
  Adressen des Servers sowie (falls vorhanden) eine Tailscale-Adresse (CGNAT-Bereich
  `100.64.0.0/10` wird erkannt und separat als „unterwegs erreichbar" ausgewiesen), mit kurzer
  Anleitung fürs Home-Bildschirm-Symbol. Virtuelle/Tunnel-Netzwerkadapter werden dabei
  ausgeblendet, sonst tauchen falsche, nie erreichbare Adressen auf -- neben WSL/Hyper-V/Docker/
  VMware/VirtualBox insbesondere auch VPN-Clients (NordVPN/NordLynx, WireGuard, OpenVPN), deren
  Adressen reine Tunnel-Adressen sind.

## Bedienung

- **Schnellerfassung**: von überall per Klick oder Taste `n` eine neue Pendenz erfassen;
  Minimalfelder Titel + Fälligkeit reichen, Rest optional.
- **Ein-Klick-Aktionen** in der Liste: Status per Auswahlfeld ändern (bei Hauptaufgaben/
  eigenständigen Pendenzen), Abhaken per Checkbox (ausser in „Alle Pendenzen"/Mandanten, wo die
  Checkbox bleibt -- im Cockpit entfällt sie, da Klick auf eine Zeile ohnehin die Vorschau
  öffnet). Beim Abhaken automatisch Erledigungsdatum setzen; beim Wechsel auf „Warte auf Kunde"
  ohne Angabe automatisch „warte seit heute".
- **Tastatur**: Pfeiltasten bewegen den Fokus in der Liste, Enter öffnet die Vorschau (bzw. das
  Bearbeiten-Fenster, wo keine Vorschau-Spalte existiert), Leertaste hakt ab bzw. macht das
  Abhaken rückgängig.
- **Detailansicht (Modal)** einer Pendenz zeigt die ID im Titel („Pendenz 42 bearbeiten"), alle
  Felder inkl. Bearbeiter/in-Auswahl, sowie:
  - **„📅 In Kalender speichern (.ics)"** -- lädt einen einstündigen Termin am
    Fälligkeitsdatum herunter, beginnend zur aktuellen vollen Stunde (lokale Zeit; ein
    Stundenüberlauf über Mitternacht wird korrekt in den nächsten Tag aufgelöst). Kein
    ganztägiger Termin mehr.
  - **„✉ E-Mail senden"** -- Formular mit dem Empfänger-Feld **immer leer** (keine
    automatische Vorbelegung, auch wenn ein Mandant mit hinterlegter E-Mail zugeordnet ist).
    Darüber Schnellauswahl-Buttons -- Ansprechpartner/in, Geschäftsführung (falls hinterlegt),
    Bearbeiter/in -- die den *aktuell im Formular gewählten* Mandanten/Bearbeiter
    nachschlagen (nicht den beim Öffnen geladenen Stand, falls man die Auswahl vor dem
    Versenden noch ändert). Betreff automatisch `Mandant: Titel` (ohne Mandant nur der Titel).
    Checkbox „Als Kalendertermin anhängen (.ics)". Sichtbar nur, wenn SMTP eingerichtet ist.
    Jeder erfolgreiche Versand wird protokolliert und erscheint darüber als grüne Liste
    (✔ Datum, Empfänger).
  - **Teilaufgaben-Abschnitt** (nur bei Hauptaufgaben, nicht bei Teilaufgaben): Liste mit
    Abhaken/Löschen und je einem 📅-Kalender-Link, darunter ein Eingabefeld für eine neue
    Teilaufgabe (Titel volle Breite; Datum + „Hinzufügen" in der Zeile darunter). Die
    Hauptaufgabe zeigt in den Listen einen Fortschritts-Badge „2/5" (Mini-Balken + Zahl).
  - **„Fortschritt"-Abschnitt**: Liste bereits erfasster Notizen (Datum, Ersteller, Text,
    löschbar) plus Textfeld + „+ Eintrag hinzufügen" für neue Einträge -- dokumentiert Schritte,
    die schon unternommen wurden, unabhängig von der festen Beschreibung.

## E-Mail und Kalender

- SMTP-Konfiguration über die Einstellungen-Seite; Werte landen in der App-Einstellungen-Tabelle
  und werden beim Serverstart in `process.env` übernommen. Ohne Konfiguration zeigen die
  E-Mail-Funktionen einen Hinweis statt Fehler.
- `POST /api/mail/senden` `{an, betreff, text, kalender?, pendenzId?}` -- versendet per
  nodemailer; ist `kalender` (`{titel, faelligkeit, beschreibung}`) gesetzt, wird eine
  `.ics`-Datei angehängt; ist `pendenzId` gesetzt, wird der Versand in `pendenz_emails`
  protokolliert.
- `POST /api/mail/test` -- schickt eine Testnachricht an die eigene Absenderadresse (nicht
  protokolliert).
- `GET /api/pendenzen/:id/ics` -- liefert die `.ics`-Datei zum Download (Content-Disposition
  attachment, Dateiname aus dem Titel).
- `GET /api/pendenzen/:id/emails` -- Versandhistorie einer Pendenz, neueste zuerst.
- ICS: minimales, gültiges VCALENDAR/VEVENT (RFC 5545), einstündiger Termin ab der aktuellen
  vollen Stunde (`DTSTART`/`DTEND` ohne „Z", lokale Zeit), Sonderzeichen escaped.

## Fortschrittsnotizen -- API

- `GET /api/pendenzen/:id/notizen` -- Liste, neueste zuerst.
- `POST /api/pendenzen/:id/notizen` `{text}` -- legt eine Notiz an, Ersteller = angemeldete
  Person.
- `DELETE /api/pendenzen/:id/notizen/:notizId`.

## Responsives Layout

Die App läuft auch als installierte PWA auf dem iPhone (Manifest + Icon-Set in allen gängigen
Grössen) und wird auf unterschiedlich grossen Bildschirmen genutzt (externer Monitor, Laptop),
darum muss sich die Ansicht echt anpassen:

- **Automatische Skalierung statt Umbruch** (zentral, z.B. in einer immer gemounteten
  `AuthGate`-Komponente): die ganze App wird wie eine Browser-Zoomstufe verkleinert, wenn das
  Fenster kleiner wird -- gleiches Layout (insbesondere die drei nebeneinander stehenden Spalten
  Kategorien/Kalender + Liste + Vorschau) bleibt bei **jeder** Fensterbreite erhalten, nur
  kleiner dargestellt, statt dass Spalten umbrechen oder Text abgeschnitten wird (Vorbild:
  Outlook -- verschiebt man das Fenster auf einen kleineren Bildschirm, wird alles kleiner, aber
  im selben Format). Implementiert über `document.documentElement.style.zoom`, berechnet aus
  `window.outerWidth` (physische Fenstergrösse -- **nicht** `innerWidth`, das durch den
  gesetzten CSS-Zoom selbst rückwirkend beeinflusst würde und sich bei jedem Resize-Event
  aufschaukeln könnte) relativ zu einer Referenzbreite (~1500px, der Breite, für die das Layout
  bei Zoom 100% entworfen ist) -- nach unten begrenzt auf ~70%, nach oben auf ~130%: auf einem
  grossen externen Monitor darf die Ansicht also auch grösser als 100% werden, nicht nur auf
  100% gedeckelt sein. Reicht selbst 70% nicht mehr aus, wird **nicht** gestapelt/umgebrochen,
  sondern die betroffene Karte bekommt eine horizontale Scrollleiste (`overflow-x: auto`) -- die
  drei Spalten bleiben so oder so bestehen, das war eine explizite Anforderung (kein Umbruch,
  lieber selbst scrollen).
- **≤640px** (Handy): einzige Ausnahme vom „nichts stapelt"-Grundsatz -- die feste, 208px breite
  Seitenleiste (hätte auf einem iPhone über die Hälfte des Bildschirms belegt) wird zu einer
  schmalen, horizontal scrollbaren Kopfleiste; Seitenränder und Titelgrösse schrumpfen passend
  mit. Betrifft nur die Navigation, nicht die Spalten-Layouts.
- Die Pendenzen-Tabelle hat eine Mindestbreite (damit `table-layout: fixed` die Titel-Spalte bei
  wenig Platz nicht auf 0 zusammendrückt und Inhalt sich über Nachbarspalten legt) und scrollt
  bei Bedarf horizontal in einem eigenen Container statt sich zu verformen.
- Abgeschnittene (durch `text-overflow: ellipsis` gekürzte) Titel -- in Tabellenzeilen wie in
  Teilaufgaben-Listen -- tragen ein natives `title`-Attribut mit dem vollständigen Text, sodass
  ein Mauszeiger-Tooltip beim Hovern den ganzen Titel zeigt.

## Startdaten und Skripte

- `npm run seed` -- leert die Datenbank und füllt sie mit Demo-Daten: 4 Beispielmandanten;
  Regeln für MWST (quartalsweise, 60 Tage nach Quartalsende, Vorlauf 30), Lohnlauf (monatlich,
  25., Vorlauf 7), Zahlungslauf (zweimal monatlich, 15./28.), Jahresabschluss (jährlich,
  30.06. Folgejahr, Vorlauf 120); Beispiel-Pendenzen in verschiedenen Status inkl. einer
  überfälligen und einer „Warte auf Kunde"; eine Hauptaufgabe mit drei Teilaufgaben; plus die
  automatisch generierten Pendenzen.
- `npm run leeren` -- löscht alle Daten (Mandanten, Regeln, Pendenzen), ohne Demo-Daten
  einzufügen. Team/Logins bleiben.
- Nicht-destruktive Schema-Migrationen beim Öffnen der Datenbank: fehlende Spalten/Tabellen
  werden ergänzt, bestehende Daten bleiben unangetastet.

## Vorgehen

Arbeite in dieser Reihenfolge und zeige nach jedem Schritt kurz den Stand:

1. Projektstruktur, Datenbankschema (inkl. `pendenz_emails`, `pendenz_notizen`, zweites
   Mandant-E-Mail-Feld), Seed-Daten, `recurrence.js` mit Unit-Tests (Quartals- und
   Jahreswechsel, Monatsenden inkl. Schaltjahr, „letzter Tag des Monats" im Februar).
2. Backend-API: Auth (Login, Sitzungen, Passwort festlegen, Middleware), CRUD für Mandanten,
   Team, Regeln, Pendenzen; Status-Verknüpfung Haupt-/Teilaufgabe (mit Unit-Tests: bottom-up,
   top-down, kombiniert); Generierungslogik mit Tests für Idempotenz und Nachtragsfenster;
   E-Mail-, ICS- und Notizen-Routen.
3. Frontend: AuthGate + Login + Ersteinrichtung, dann die Ansichten in der Reihenfolge
   Cockpit (Fälligkeiten-Karte + Kalender-Karte) → Alle Pendenzen → Mandanten → Regeln →
   Archiv → Team → Einstellungen. Gemeinsame Tabellen-Komponente mit Vorschau-Spalte zuerst
   bauen, dann in Cockpit/Alle Pendenzen einsetzen.
4. Feinschliff: Tastenkürzel, Schnellerfassung, überfällig-Markierung, eingerückte/einklappbare
   Teilaufgaben mit `1.1`-Nummerierung, App-Icon (Favicon + PWA-Icons + Web-App-Manifest),
   automatische Bildschirm-Skalierung + Handy-Breakpoint (siehe „Responsives Layout"),
   Titel-Tooltips, Single-Prozess-Auslieferung des Frontends, `Dockerfile` +
   `docker-compose.yml` + `Caddyfile`.

Schreibe für die Wiederkehr-Logik, die Status-Verknüpfung Haupt-/Teilaufgabe und die
Authentifizierung Unit-Tests.
