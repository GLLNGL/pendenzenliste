# Prompt: Auftragsmanagement (ehem. Pendenzenliste) – Offerten, Zeiterfassung, Mandanten, Buchhaltung (v7)

Diese Fassung erweitert `prompt-pendenzenliste-v6.md` (aktueller Stand Pendenzen, Layout,
Typografie, Arbeitsweise). Was dort steht und hier nicht anders beschrieben ist, gilt weiter.

---

## Ziel

Aus der Pendenzenliste wird ein gesamtheitliches Tool für das Treuhandbüro:

1. **Offertenberechnung** – ersetzt den Excel-Preiskalkulator
   (`EST_Preiskalkulator_Angebot_5.xlsx`, Blätter Kalkulation, Dienstleistungen, Mandanten,
   ABACUS Module, Angebot).
2. **Stundenerfassung** pro Mandant beim Bearbeiten von Pendenzen (Timer + von Hand).
3. **Detailrapport** pro Mandant und Zeitraum, der mit der Rechnung versendet wird.
4. **Rentabilität:** Jede erfasste Zeit ist entweder **Pauschale** (gehört zu einer vereinbarten
   Pauschal-Leistung) oder **Extra** (wird zum Stundenansatz verrechnet). Daraus ergibt sich pro
   Mandant und Leistung der effektive Stundensatz (Pauschalertrag ÷ Stunden) im Vergleich zum
   Zielsatz und zur offerierten Planzeit.

## Preislogik (aus dem Excel übernommen)

- **Stundenansätze** als eigene Liste: «Standard» CHF 130 (Standardansatz) und
  «Kreditoren/Debitoren» CHF 90. Jede zeitbasierte Leistung verweist auf einen Ansatz.
- **Leistungskatalog:** Name, Einheit (Beleg, MA, Std., Pauschale …), Turnus (monatlich oder
  jährlich – jährliche Leistungen werden für die Monatspauschale durch 12 geteilt),
  Zeit pro Einheit in Minuten, Preisart:
  - *zeitbasiert:* CHF/Einheit = Minuten ÷ 60 × Ansatz (z.B. 3 Min./Beleg × 130 = 6.50)
  - *Festpreis:* CHF/Einheit fix (z.B. Lohnbuchhaltung 35/MA); die Zeit pro Einheit ist dann
    die **Planzeit** für den Soll-/Ist-Vergleich.
  - Optional «Gruppe im Angebot»: Positionen derselben Gruppe erscheinen in der Offerte als eine
    Zeile (z.B. «Lohnbuchhaltung (inkl. Lohnausweise)»).
- **ABACUS-Module:** Lizenzen mit CHF/Monat, optional Einkaufspreis (für die Lizenzmarge). Sie
  sind Teil der Monatspauschale, zählen aber nicht in die Zeit-Rentabilität.
- **Offerte:** Monatspauschale = Summe der Positionen (CHF/Mt.), Rabatt % auf das Total,
  Skonto, MWST 8.1 % wenn pflichtig, Gültigkeit 30 Tage, fortlaufende Nummer `A-JJJJ-NN`.
  Konditionen-Text und Absenderdaten in den Einstellungen.
- **Pauschalen pro Mandant:** eine Zeile pro Leistung bzw. ABACUS-Modul mit vereinbarter Menge
  und Betrag pro Monat **nach Rabatt**, gültig ab/bis. Planzeit/Mt. = Menge × Zeit pro Einheit
  (jährlich: ÷ 12).

## Etappen

1. **Grundlagen** – Stundenansätze, Leistungskatalog, ABACUS-Module (Startwerte aus dem Excel)
   in der neuen Ansicht «Preise»; Mandanten mit Kunden-Nr., Ansprechperson, Adresse, Telefon und
   Status «Potenziell»; Pauschalen pro Mandant (Mandanten-Ansicht → «Pauschalen»).
2. **Zeiterfassung** – Tabelle `zeiteintraege` (Mandant, optional Pendenz, Person, Datum,
   Minuten, Art Pauschale/Extra, Leistung, Rapporttext, Ansatz beim Erfassen festgehalten,
   Timer-Start, Rapport-Verknüpfung). Timer Start/Stopp in der Detailansicht und auf dem Handy;
   beim Stoppen Pauschale/Extra wählen, Leistung vorgeschlagen (Standard-Leistung an Pendenz
   bzw. Regel). Erfassen von Hand, Zeitjournal (filterbar, korrigierbar). Interne Zeit ohne
   Mandant zählt nicht in die Mandanten-Rentabilität.
3. **Detailrapport** – Druckansicht/PDF pro Mandant und Zeitraum mit Logo: Pauschal-Arbeiten mit
   Zeit ohne Betrag, Extra-Arbeiten mit Zeit, Ansatz und Betrag (exkl. MWST), Zeiten auf 5 Min.
   gerundet. Danach Einträge als verrechnet markieren (Tabelle `rapporte`), damit nichts doppelt
   verrechnet wird.
4. **Rentabilität** – pro Mandant/Leistung/Zeitraum: anteiliger Pauschalertrag, Planstunden vs.
   erfasste Stunden, effektiver Satz vs. Zielsatz (Ampel), Extra-Ertrag, optional interner
   Kostensatz.
5. **Offerten** – Tabellen `offerten` + `offert_positionen`; Mengen eingeben → Vorschlag →
   Druckansicht/PDF im Layout des bisherigen Blatts «Angebot». Angenommene Offerte erzeugt die
   Pauschalen des Mandanten. Ersetzt danach das Excel.

## Etappe 1 – umgesetzt

- Schema (`supabase/schema.sql`, Abschnitt «Preise & Pauschalen»): `stundenansaetze`,
  `leistungen`, `abacus_module`, `mandant_pauschalen`, neue Mandanten-Spalten `kunden_nr`
  (eindeutig), `ansprechperson`, `strasse`, `plz`, `ort`, `telefon`, `potenziell`.
  Startwerte (Ansätze, 10 Leistungen, 7 ABACUS-Module) werden nur eingefügt, solange die
  jeweilige Tabelle leer ist. Kundendaten aus dem Excel werden bewusst **nicht** ins Schema
  geschrieben (Repo), sondern im Mandanten-Fenster erfasst.
- Ansicht **Preise** (`views/Preise.jsx`): drei Tabellen mit Bearbeiten-Fenster.
- Mandanten-Fenster: Kunden-Nr. (Vorschlag nächste freie `M-NNN`), Ansprechperson, Adresse,
  Telefon; Status Aktiv / Potenziell / Inaktiv.
- Mandanten-Ansicht: Eckdaten-Zeile zeigt die Monatspauschale; Knopf «Pauschalen» öffnet die
  Positionen des Mandanten (Listenpreis aus dem Katalog als Vorschlag, Betrag nach Rabatt
  editierbar, Planzeit/Mt.).
- Reine Rechenlogik in `lib/preise.js` mit Unit-Tests (`tests/preise.test.js`).

## Navigation analog Abacus – umgesetzt

- App-Name **«Auftragsmanagement»** (Repo/URL weiterhin `pendenzenliste`).
- Seitenleiste oben: Feld **«Modul»** mit Auswahlliste (Tippen filtert), darunter der
  Programmbaum (Gruppen einklappbar, Programmnummern rechts; `lib/module.js`,
  `components/ModulNavigation.jsx`). `/start` zeigt alle Module als Kacheln. Die Seitenleiste
  lässt sich am rechten Rand breiter ziehen (180–520 px, pro Gerät gemerkt, Doppelklick =
  Standard).
  - **10 Pendenzen:** 11 Cockpit, 12 Eingang, 13 Alle Pendenzen · 21 Zu planen,
    22 Wiederkehrende, 23 Wochenrückblick, 24 Übersicht & Kalender · 31 Archiv ·
    41 Zeitjournal
  - **20 Kundenstamm:** 11 Mandanten, 12 Onboarding-Unterlagen · 21 Detailrapporte
  - **30 Preiskalkulation:** Gruppe «Angebot» 11 Offerten · Stammdaten 21 Preise & Katalog
  - **40 Buchhaltung:** 11 Kreditoren, 12 Debitoren · 21 Liquiditätsplan
  - **90 Administration:** 11 Team, 12 Einstellungen

## Offerten (Etappe 5, vorgezogen) – umgesetzt

- Tabellen `offerten`, `offert_positionen` (Momentaufnahme von Bezeichnung, Einheit, Turnus,
  Preis), `buero_einstellungen` (Absender, Konditionen, Mail-Vorlage).
- Liste (`views/Offerten.jsx`) und Editor (`views/OffertEditor.jsx`): Mandant per Such-Popup
  (`MandantSuche`, filtert ab dem ersten Buchstaben: Namensanfang, dann Wortanfang), neuer
  Interessent direkt aus der Offerte, A4-Vorschau (`OffertDokument`) im Layout des
  Excel-Angebots, Drucken, PDF (`lib/pdf.js`, jspdf + html2canvas, unskalierte Kopie),
  Versand per E-Mail mit PDF-Anhang (Edge Function `send-mail` mit `anhaenge`).
- Annahme = Mandatseröffnung: Pauschalen nach Rabatt ab Datum, bisherige optional beenden,
  potenzieller Mandant wird aktiv. Kalkulation zeigt Planzeit und Ertrag pro Planstunde.

## Etappe 2 (Zeiterfassung) – umgesetzt

- Timer in der Seitenleiste (läuft auf jeder Seite sichtbar), in der Detailansicht jeder
  Pendenz (Start/Stopp, erfasste Zeit, Einträge) und im Handy-Tab «Zeit». Ein neuer Timer
  stoppt einen laufenden automatisch.
- Zeit-Fenster (`ZeitModal`): Datum, Dauer (h:mm, Stunden oder Minuten), Mandant (leer =
  intern), Leistung, Art Pauschale/Extra (vorgeschlagen aus den Pauschalen des Mandanten),
  Ansatz bei Extra (aus Leistung bzw. Standard), Text im Rapport.
- Zeitjournal (Modul 40, Programm 11): Filter Zeitraum/Mandant/Person/Art, Summen.
- Standard-Leistung an Pendenz und Wiederkehr-Regel; die Pendenz merkt sich die zuletzt
  gewählte Leistung.

## Cockpit und Planung – umgesetzt

- Cockpit (`views/TagesCockpit.jsx`, `lib/tagesplan.js`): **vier Spalten** Abgelaufen · Heute
  · Morgen (nächster Arbeitstag) · Wochenziele; pro Mandant als Kachel, darin Projekt →
  Teilaufgaben (aufgeklappt, abhakbar). Schriftgrössen: Mandant > Projekt > Teilaufgabe.
- **Heute** = Bearbeitungstag heute, heute fällig oder «In Arbeit»; Bearbeitungstag hat
  Vorrang (auf Montag gelegt = erst Montag sichtbar).
- **Abgelaufen** = offene Frist, Bearbeitungstag oder Nachfassdatum vor heute, mit Grund und
  Dauer; verlässt die Spalte, sobald neu entschieden (auf heute/später gelegt oder bewusst
  «Zu planen» → Spalte `pendenzen.zu_planen_seit`).
- Knöpfe in jeder Spalte: → Heute, → Morgen, Zu planen (eigene Spalte entfällt); «Warten auf»
  wird über das Nachfassdatum verschoben.
- Ordner **«Zu planen»** = offene Pendenzen ohne Bearbeitungstag. Frist ist freiwillig.
- Neue Pendenz = **Projekt** (`ProjektModal`): Titel, Mandant, Verrechnung Pauschal/Extra
  (Standard Pauschal), Frist, Beschreibung (Diktat), Teilschritte mit Bearbeitungstag, Aufwand,
  Verrechnung; Aufwand summiert. Friständerung des Projekts verschiebt offene Schritte.

## Aufträge per E-Mail (Eingang) – umgesetzt

- Edge Function **`mail-eingang`**: holt Mails aus dem IMAP-Ordner «Aufträge»
  (info@estcontrolling.ch, Secrets `IMAP_*`), fasst sie mit Claude zusammen
  (`ANTHROPIC_API_KEY`, Modell `claude-opus-5-5`), To-dos als Teilschritte, Mandant über
  Absender/Domain, verschiebt nach «Aufträge/Übernommen». Anhänge kommen in den
  Supabase-Speicher (Bucket `dateien`) und hängen an der Pendenz; früher übernommene Mails
  bekommen ihre Anhänge beim nächsten Abruf nachgeholt.
- Eingang: Einplanen öffnet das Projekt-Fenster, Löschen mit Rückfrage.

## Mandanten, Ablage und Onboarding – umgesetzt

- **Mandanten** (`views/Mandanten.jsx`): Liste Aktive / Interessenten / Inaktive mit Suche;
  Detail mit Phasen Erfasst → Offerte → Angenommen → Onboarding → Mandat läuft und Reitern
  Stammdaten & Ablage · Offerten (Neue Offerte direkt) · Onboarding · Erledigte Aufträge.
  Keine offenen Pendenzen hier.
- **Ablage:** Grundordner in den Einstellungen (Pfad, SharePoint-Adresse, Unterordner für
  Mail-Anhänge); beim Mandanten nur der Ordnername (`mandanten.ablage_ordner`, «Ordner
  wählen…» per Ordnerauswahl). Der lokale OneDrive-Grundordner wird pro Gerät freigegeben
  (File System Access API, Edge/Chrome; `lib/ablageOrdner.js`).
- **Dateien** (`dateien`, Bucket `dateien`): beim Speichern eines Projekts werden noch nicht
  abgelegte Anhänge in den Mandantenordner geschrieben und danach aus dem App-Speicher
  gelöscht; es bleibt ein Eintrag mit Datum und Ablageort (`abgelegt_in`).
- **Onboarding:** Katalog `onboarding_unterlagen` (DL-Vertrag, Vollmacht, Bestellung EBICS …,
  Vorlage-Datei zum Mitsenden), pro Mandant `mandant_onboarding` mit Checkliste, Mail mit
  Anhängen, Rücklauf abhaken, abschliessen. Offerte angenommen → «Onboarding öffnen».

## Preiskalkulation – Ergänzungen

- Leistungskatalog ergänzt (Excel «nur JAS und MWST»): MWST effektiv Standard/komplex,
  Saldosteuersatz (Turnus Jahr, Standardmenge 4 bzw. 2, Gruppe «MWST»), fünf
  «JAS – …»-Positionen (Std., Gruppe «Jahresabschluss»), Steuererklärung juristische Person.
  Neue Spalte `leistungen.standard_menge` = Mengenvorschlag in der Offerte.
- Offerte › Dienstleistungen: **Buchungsjournal/Bankauszug hineinziehen** (CSV, .xlsx,
  camt-XML im Browser, PDF per KI) → Buchungen pro Monat, Ø/Maximum als Menge in eine
  Beleg-Leistung (Standard «Finanzbuchhaltung (Standard)», 3 Min. × CHF 130).

## Buchhaltung (Modul 40) – umgesetzt

- **Kreditoren / Debitoren** (`views/Belege.jsx`, Tabelle `belege`): PDF/Bild hineinziehen →
  KI liest Partner, Adresse, Nr., Datum, Fälligkeit, Betrag, IBAN, Referenz (Edge Function
  `beleg-lesen`); Rechnung links neben den Feldern; «Speichern & ablegen» legt den Beleg in
  OneDrive ab (EST Controlling › `08_Buchhaltung` › Kreditoren|Debitoren › Jahr), in der App
  nur die Liste. «Fehlende Angaben auslesen» für alte Belege.
- **Zahlungslauf** (Kreditoren, `lib/pain001.js`, Tabelle `zahlungslaeufe`): Rechnungen
  ankreuzen → Prüfung IBAN/QR-IBAN/QR-/RF-Referenz → **pain.001.001.09 (SPS 2022)** für den
  UBS-Upload; Valuta = nächster Bankwerktag; Adresse freiwillig. Rechnungen im Lauf stehen
  beim Lauf (aufklappbar), «Auflösen» bringt sie zurück, «✓ bezahlt» setzt das
  Ausführungsdatum.
- **Rechnungsversand** (Debitoren): «✉ Senden» mit PDF aus OneDrive, Mandant wählbar (Adressen
  als Knöpfe), Standardtext `buero_einstellungen.rechnung` (QR-Einzahlungsschein, 10 Tage),
  Versand vermerkt (`versendet_am/an`).
- **Kontoauszug einlesen** (Debitoren, `lib/kontoauszug.js`, `KontoauszugModal`): camt.053/054,
  CSV/Excel, PDF per KI → Zahlungseingänge mit offenen Debitoren abgleichen (QR-Referenz,
  Betrag + Nr./Name, nur Betrag), prüfen, als bezahlt verbuchen; Schlusssaldo optional als
  Kontostand (Stichtag = Folgetag).
- **Liquiditätsplan** (`lib/liquiditaet.js`): Kontostand (Stand **vor** den Zahlungen des
  Stichtags) · Zahlungen seit Kontostand · pro Woche/Monat Zuflüsse (Debitoren), Abflüsse
  (Kreditoren nach Fälligkeit), **Zahlungsausgänge** (bezahlt bzw. im Zahlungslauf nach
  Ausführungsdatum), Saldo, Liq. Stand, Engpass markiert. Überfällige offene Rechnungen nur als
  Info: theoretischer Stand «inkl. Überfälliges» und pro Kreditor «bezahlbar ab». Vergleich
  der Ø-Zahlungsfristen Debitoren vs. Kreditoren.

## E-Mails – umgesetzt

- Jede Mail aus der App (zentral in `api.js` → `sendMailAufrufen`, `lib/mail.js`): HTML in
  **Arial 10 pt**, Schlussgruss durch die **Signatur** ersetzt (Einstellungen, Standard Angelo
  Gallo / EST Controlling), Logo eingebettet (cid), **CC/BCC**.
- Mail-Fenster gross (85 %), Grössen-Regler oben rechts (50–100 %, gemerkt) und Ziehgriff;
  Fenster schliessen nur bei Klick, der auf dem Hintergrund beginnt (`lib/modal.js`).

## Technik und Betrieb

- Edge Functions (Dashboard-Name ≠ Aufrufpfad!): `send-mail` = **`clever-processor`**,
  `beleg-lesen` = **`rapid-handler`** (Modi: Beleg, `buchungen`, `kontoauszug`),
  `mail-eingang` = `mail-eingang`. Code liegt unter `supabase/functions/…`; nach Änderungen im
  Dashboard ersetzen und deployen (der Nutzer).
- SQL: `supabase/schema.sql` ist vollständig und idempotent (View `pendenzen_angereichert`
  am Dateiende neu erstellt). Einzeldateien für den Nutzer: `projekte-v7`, `mail-eingang-v7`,
  `mandanten-onboarding-v7`, `dateien-abgelegt-v7`, `zu-planen-v7`, `buchhaltung-v7`,
  `belege-zahlung-v7`, `zahlungslauf-v7`, `leistungen-jas-mwst-v7`, `rechnung-versand-v7`,
  `rechnung-text-v7` (alle ausgeführt, Stand 11.11.2026, ausser ggf. rechnung-text-v7).
- Arbeitsweise: committen ja, **pushen nur nach «Ja, pushen»**; SQL führt der Nutzer im SQL
  Editor aus; nichts löschen ohne Rückfrage; keine Kundendaten ins Repo. Beim Bearbeiten
  von Dateien mit Backslashes/Regex nicht über Shell-Heredocs (Escaping geht verloren) –
  Editor bzw. Skriptdatei verwenden. Tests: `cd frontend && node --test tests/`.

## Offene Punkte (zusätzlich zu v6)

1. Planzeit für Lohnbuchhaltung, Lohnausweise und Budgetierung im Katalog ergänzen (im Excel
   ohne Bearbeitungszeit).
2. Interner Kostensatz (Etappe 4) – global oder pro Person.
3. Kontoauszug: Belastungen mit Kreditoren/Zahlungsläufen abgleichen (ausgeführt → bezahlt).
4. Erster echter Test: Kontoauszug-Abgleich (camt von UBS), PDF-Kontoauszug per KI.
5. Direkt-Upload nach SharePoint (Microsoft Graph) statt lokaler OneDrive-Freigabe – optional.
