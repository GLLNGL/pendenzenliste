# Prompt: Pendenzenliste für ein Treuhandbüro (aktueller Stand v6)

Diese Fassung beschreibt den **aktuellen Stand** nach dem Arbeitsprozess (v5) und der
anschliessenden Überarbeitung von Layout und Typografie (November 2026). Sie ergänzt
`prompt-pendenzenliste-v5.md` (Arbeitsprozess, Datenmodell, Regeln) und
`prompt-pendenzenliste-v4.md` (Technik: React/Vite, Supabase, GitHub Pages, Login, Handy-Ansicht).
Was dort steht und hier nicht anders beschrieben ist, gilt weiter. v1–v5 bleiben als Historie.

---

## Kurzüberblick

Pendenzenliste für zwei Personen (Treuhand, mehrere Mandanten, Arbeit mit Abacus). Jede Pendenz
ist ein konkreter **nächster Schritt**. Unterstützter Ablauf: Triage im Eingang, WIP-Limit 3,
Tagesstart/-abschluss, Themenblöcke, Wochenrückblick am Freitag, wiederkehrende Mandatsarbeiten
mit Vorlauf (Details: v5).

- **Online:** `https://gllngl.github.io/pendenzenliste/` (GitHub Pages, Repo `GLLNGL/pendenzenliste`,
  Deploy per GitHub Actions bei jedem Push auf `main`, Dauer ca. 1–2 Min., gelegentlich Warteschlange).
- **Installation am PC:** Seite in Edge/Chrome öffnen → «App installieren» (PWA mit Logo).
- **Datenbank:** Supabase (Postgres). Schema in `supabase/schema.sql`, handgepflegt und idempotent;
  Änderungen führt der Nutzer selbst im Supabase SQL-Editor aus (ganze Datei, mehrfach ausführbar).

## Layout-Prinzip (gilt für alle Pendenzen-Ansichten)

Eine einzige, einheitliche **Arbeitskarte** (`components/PendenzArbeitsliste.jsx`), verwendet in
Cockpit-Übersicht, Alle Pendenzen, Mandanten und Archiv:

- **Kopf:** Titel (z.B. «Übersicht · Heute bearbeiten»), Anzahl Pendenzen und **geschätzte
  Gesamtzeit** («7 Pendenzen · 10 h geschätzt», ggf. «(n ohne Schätzung)»).
- **Optional linke Spalte:** Bereiche (Cockpit) bzw. Mandanten (Mandanten-Ansicht).
- **Mitte:** schlichte, **nach Mandant gruppierte Liste** (`components/PendenzGruppenListe.jsx`):
  - Mandantenkopf: Name, Anzahl, geschätzte Zeit des Mandanten; **Klick klappt ein/aus**
    (eingeklappt bleibt nur der Kopf), Zustand pro Liste in `localStorage`.
  - Eine Zeile pro Pendenz: nächster Schritt · Datum (Frist, rot wenn überfällig, «!» bei harter
    Frist; im Archiv Erledigt-Datum; im Kalender keins) · geschätzte Zeit · Status.
    Priorität A = roter Strich links. Feste Spalten, alles bündig.
  - **Projekte:** Projekt-Kopf getönt, halbfett, ▣-Symbol, Badge «PROJEKT x/y»; Schritte darunter
    eingerückt, kleiner und grau, an einer Baumlinie (├ / └). Fehlt der Kopf in der Liste
    (Cockpit/Kalender zeigen nur Schritte), steht eine nicht klickbare Projekt-Titelzeile darüber.
    Projekt-Köpfe zählen weder als Pendenz noch als «ohne Schätzung».
- **Rechts:** kompakte **Detailansicht** (`PendenzVorschau`, 380 px); Status dort änderbar,
  Klick darauf öffnet das Bearbeiten-Fenster.
- Die Karte füllt die Fensterhöhe (Seiten mit `.arbeitsseite`), nur Liste und Detailansicht scrollen.

## Typografie

- Schrift **Inter**, lokal mitgeliefert (`@fontsource-variable/inter`, kein Google-Abruf),
  gleich breite Ziffern.
- Schriftskala als CSS-Variablen in `index.css`: `--fs-titel` 24, `--fs-gross` 17,
  `--fs-abschnitt` 15, `--fs-text` 13.5, `--fs-klein` 12.5, `--fs-liste` 13,
  `--fs-liste-klein` 12, `--fs-label` 11 (Beschriftungen in Grossbuchstaben, eine gemeinsame Regel).
- Listenzeilen 12 px, Mandantenköpfe 12.5 px fett, Status 11 px, Pendenz-Titel nicht fett.
- Detailansicht kompakt (Titel 13.5 px, Text 12 px, Eckdaten 11 px).
- Zahlen im Schweizer Format (`de-CH`, Dezimalpunkt: «4.5 h»).

## Die Ansichten

- **Cockpit:** schmale Kopfzeile (Titel + Arbeitsrhythmus), schmale **Kennzahlen-Leiste**
  (In Arbeit x/3, nächste Woche h/Fokuszeit mit Balken, Block-Filter; Erklärungen im Tooltip).
  Darunter die Übersicht (Bereiche: Fällig ≤ 5 Arbeitstage, In Arbeit, Nachfassen mit Knopf
  «Erinnerungs-Mails vorbereiten», Wochenziele, Heute bearbeiten, Unverändert > 14 Tage) und
  darunter der **Kalender**.
  - **Regler** zwischen Übersicht und Kalender: stellt die Kalendergrösse ein (60–100 % der
    Originalgrösse); kleiner gezogen wird nur das Monatsraster per CSS-`zoom` verkleinert
    («Zoom-out»), die Übersicht füllt per Flexbox den Rest. Pointer-Events mit Capture, Zoom direkt
    aus dem Mausweg, max. ein Update pro Frame, kein Rerender beim Ziehen. Doppelklick = Original.
    Gespeichert als `cockpit-kalender-zoom`.
  - **Kalender:** Mini-Kalender (Navigation im Kartenkopf, feste 28-px-Zellen, Punkt im Tageskreis),
    daneben die Pendenzen des angeklickten Tages (gleiche Gruppenliste, ohne Datumsspalte, mit
    Gesamtzeit im Titel) und rechts dieselbe Detailansicht. Nur die Tagesliste scrollt, der
    Kalender bleibt stehen. Auf dem Handy (`MobilKalender`) ohne Detailansicht.
- **Alle Pendenzen:** Kopfzeile, kompakte Filterleiste (Suche, Status, Mandant, Priorität, Block,
  Fällig von/bis), darunter die Arbeitskarte.
- **Mandanten:** links Mandantenliste («Alle Mandanten», je Mandant offen/überfällig, «Intern»),
  Mitte Pendenzen des gewählten Mandanten mit Eckdaten-Zeile und «Mandant bearbeiten», rechts
  Detailansicht; «+ Neuer Mandant», «Inaktive anzeigen» oben rechts. Zähler werden aus derselben
  Liste berechnet (nicht aus `mandanten_uebersicht()`), damit überall gleich gezählt wird.
- **Archiv:** Filter (Mandant, erledigt von/bis), Arbeitskarte mit Erledigt-Datum.
- **Eingang, Wochenrückblick, Wiederkehrende, Team, Einstellungen:** eigene Formen wie in v5
  (Triage-Knöpfe, Checkliste, Tabellen), übernehmen die Typografie.

## Code-Struktur (Frontend, `frontend/src`)

- `components/PendenzArbeitsliste.jsx` – Arbeitskarte (Kopf, optional links, Liste, Detailansicht).
- `components/PendenzGruppenListe.jsx` – gruppierte, einklappbare Liste inkl. Projekt-Darstellung.
- `components/PendenzVorschau.jsx`, `PendenzModal.jsx`, `NachfassMails.jsx`, `Faelligkeitskalender.jsx`.
- `lib/cockpit.js`, `lib/recurrence.js`, `lib/regelVorlagen.js`, `lib/vorschlaege.js`,
  `lib/wip.js`, `lib/wochenrueckblick.js` – reine Logik mit Unit-Tests.
- `constants.js` – u.a. `aufwandSumme` (ohne Projekt-Köpfe), `formatiereStunden`, `formatiereAufwand`.
- Entfernt: `PendenzListeNachKunde`, `PendenzListe`, `PendenzZeile`, `lib/gruppierung.js`.

## Tests und Prüfung

- `cd frontend && npm test` (Node `node:test`, 28 Tests), `npm run build`, `npm run lint`
  (bekannte, harmlose Warnungen: `AuthContext.jsx` only-export-components, `set-state-in-effect`
  in `PendenzVorschau.jsx`/`Faelligkeitskalender.jsx`).
- SQL: `supabase/pruefung-etappe1.sql`, `supabase/test-etappe2.sql` (rollt zurück).
- Datensicherung: `frontend/scripts/backup-supabase.mjs` → `backups/` (in `.gitignore`).

## Arbeitsweise in diesem Projekt (für neue Sitzungen)

- Oberfläche, Meldungen, Kommentare: Deutsch (Schweiz), «ss» statt «ß», echte Umlaute.
- Vor Datenmodell-Änderungen Freigabe einholen; bestehende Daten nie verlieren; **nichts löschen
  ohne Rückfrage**. Schema-Änderungen ins idempotente `schema.sql`, der Nutzer führt sie aus.
- Committen ja, **pushen erst nach ausdrücklicher Freigabe** (Push = Deploy online).
- Nach jeder Änderung im Browser prüfen (Dev-Server `pendenzenliste-frontend` auf Port 5199 aus
  `.claude/launch.json`; Anmeldung macht der Nutzer selbst). Die App skaliert per CSS-`zoom`
  nach der echten Fensterbreite – emulierte Fenstergrössen sind daher nur Annäherungen.
- Unter `zoom`: `offsetHeight` liefert ungezoomte CSS-Pixel, `getBoundingClientRect()` gerenderte;
  Flexbox mit `min-height: 0` auf jeder Ebene statt JS-Pixelrechnungen (siehe v4).

## Offene Punkte

1. Feiertage bei Arbeitstagen (aktuell Mo–Fr ohne Feiertage).
2. Mandanten archivieren/löschen, Status «Potenziell».
3. Einstellungen: veralteten Abschnitt «Zugriff vom Handy» (Tailscale/WLAN) durch die
   Installationsanleitung ersetzen.
4. CSS-Regeln der alten Tabellenansicht (`.pendenz-tabelle`, `.pz-td-*`, `.kunde-gruppe*`) sind
   ungenutzt und können entfernt werden.
5. Optional: «Zurücksetzen» für gespeicherte Ansichtseinstellungen; Bearbeiter-Spalte in der Liste.
