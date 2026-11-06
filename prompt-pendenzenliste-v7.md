# Prompt: Pendenzenliste → Büro-Tool mit Offerten, Zeiterfassung und Rentabilität (v7)

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

- Seitenleiste oben: Feld **«Modul»** mit Auswahlliste (Tippen filtert): 10 Pendenzen,
  20 Kundenstamm, 30 Offerten, 40 Zeiterfassung, 90 Administration (`lib/module.js`,
  `components/ModulNavigation.jsx`). Darunter der Programmbaum des Moduls: Gruppen
  einklappbar, Programmnummern rechts (z.B. Offerten 11, Preise & Katalog 21). `/start` zeigt
  alle Module als Kacheln.

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

## Offene Punkte (zusätzlich zu v6)

1. Planzeit für Lohnbuchhaltung, Lohnausweise und Budgetierung im Katalog ergänzen (im Excel
   ohne Bearbeitungszeit).
2. Interner Kostensatz (Etappe 4) – global oder pro Person.
