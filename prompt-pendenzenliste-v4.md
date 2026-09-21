# Prompt: Pendenzenliste für ein Treuhandbüro (aktueller Stand v4)

Diese Fassung ersetzt `prompt-pendenzenliste-v3.md` als Beschreibung des **aktuellen** Stands.
Der grösste Unterschied zu v3: die App läuft nicht mehr auf einem eigenen Node/Express-Server
mit lokaler SQLite-Datei, sondern als reine statische Web-App (React/Vite) gegen **Supabase**
(Postgres, Auth, Edge Functions) und wird über **GitHub Pages** öffentlich ausgeliefert. Grund:
Unabhängigkeit vom Büro-PC/Tailscale für Handy- und Zuhause-Zugriff. Neu dazugekommen sind
ausserdem eine eigene Handy-Ansicht (nur Erfassen + Kalender) und ein "Eingang" für unterwegs
erfasste, noch nicht eingeplante Notizen. v1–v3 bleiben als Historie erhalten; alles, was v3
schon beschrieben hat und hier nicht erwähnt wird (Tabellen-Design, Dreispaltiges Layout,
Status-Automatik Haupt-/Teilaufgabe, Bedienung, Responsives Zoom-Verhalten am Desktop), gilt
unverändert weiter.

---

Erstelle mir eine Pendenzenliste-Applikation für die Arbeit als Treuhänder. Ich verwalte ein
Mandantenportfolio mit wiederkehrenden Aufgaben (MWST-Abrechnungen, Lohnläufe, Zahlungsläufe,
Jahresabschlüsse) und einmaligen Pendenzen. Zwei Personen (ich und meine Frau) arbeiten mit
derselben Liste und melden sich je mit ihrer E-Mail-Adresse an.

## Technischer Rahmen (v4 -- ersetzt den entsprechenden Abschnitt aus v3)

- **Frontend**: React mit Vite (JSX, kein TypeScript), `react-router-dom` mit **`HashRouter`**
  (nicht `BrowserRouter` -- GitHub Pages hat keine Server-seitigen Rewrites für client-seitiges
  Routing), einfaches CSS mit CSS-Variablen. Gleiches dichtes, nüchternes UI wie in v1-v3.
  `vite.config.js` setzt `base: '/pendenzenliste/'` nur wenn die Umgebungsvariable
  `GITHUB_PAGES` gesetzt ist (lokal bei `npm run dev` bleibt es bei `/`).
- **Backend: kein eigener Server mehr.** Supabase uebernimmt:
  - **Datenbank**: Postgres. Schema in `supabase/schema.sql` (handgepflegt, idempotent,
    `create table if not exists` + `create or replace function/view` -- kein Migrations-Tool).
    Row-Level-Security auf jeder Tabelle, aber **Team-Zugriff** (`auth.uid() is not null`), NICHT
    Zeilen-Isolation pro Nutzer/in wie bei einer Einzelnutzer-App -- beide Personen sehen/
    bearbeiten dieselben Mandanten/Pendenzen.
  - **Auth**: Supabase Auth (E-Mail/Passwort). **Keine öffentliche Selbstregistrierung** --
    Konten werden ausschliesslich im Supabase-Dashboard angelegt (Authentication → Users, mit
    "Enable email signups" deaktiviert). Ein Trigger `handle_new_user` verknüpft ein neues
    Auth-Konto per E-Mail-Adresse automatisch mit einer bestehenden `mitarbeitende`-Zeile (falls
    vorhanden, z.B. eine vorher ohne Login angelegte Person) oder legt eine neue an.
  - **Business-Logik im Server** (Status-Kaskade Haupt-/Teilaufgabe): als Postgres-Trigger
    (`pendenzen_status_kaskade`, `pendenzen_status_nach_loeschen`), nicht mehr in Express-Routen
    -- funktional identisch zu v3 (siehe dortiger Abschnitt), inkl. der Eigenheit, dass jedes
    Speichern einer Hauptaufgabe ihre Teilaufgaben auf Offen/Erledigt zurücksetzt.
  - **Aggregationen** (Cockpit-Zähler, Mandanten-Übersicht): Postgres-RPC-Funktionen
    (`cockpit_daten()`, `mandanten_uebersicht()`), über `supabase.rpc(...)` aufgerufen.
  - **Angereicherte Sicht**: eine View `pendenzen_angereichert` joint Mandant-/Bearbeiter-Namen,
    Teilaufgaben-Zähler, Hauptaufgaben-Titel und E-Mail-Kurzinfo dazu (ersetzt die
    `TEILAUFGABEN_SPALTEN`/`EMAIL_SPALTEN`-SQL-Fragmente aus dem alten Express-Server).
  - **E-Mail-Versand**: eine Supabase Edge Function (`supabase/functions/send-mail/index.ts`,
    Deno) mit **nodemailer** (per `npm:nodemailer`-Import) -- **nicht** die Deno-Bibliothek
    "denomailer", die einen reproduzierbaren STARTTLS-Bug auf Port 587 hat. SMTP-Zugangsdaten
    liegen als Edge-Function-**Secrets** (Dashboard → Edge Functions → Secrets), nicht im Code.
    Aufruf vom Frontend über `supabase.functions.invoke(...)`.
  - **Automatische Wiederkehr-Regel-Generierung**: **noch nicht neu gebaut** (siehe "Offene
    Punkte" unten) -- das ist die einzige fachliche Lücke gegenüber v3.
- **Datenzugriff im Frontend** (`frontend/src/api.js`): ein einziges Modul mit **derselben
  Methodenform** wie der frühere `fetch('/api/...')`-Wrapper (`api.pendenzen.liste(...)`,
  `api.mandanten.erstellen(...)` usw.), innen aber direkt gegen `@supabase/supabase-js`
  (`frontend/src/lib/supabaseClient.js`). Bewusst so gehalten, damit alle Views/Komponenten
  unverändert bleiben konnten -- nur die Datenzugriffsschicht wurde ausgetauscht.
- **Hosting**: **GitHub Pages**, öffentliches Repository (private Repos brauchen einen
  bezahlten Plan für Pages) -- unkritisch, da weder Zugangsdaten noch echte Mandantendaten im
  Code liegen (Secrets sind Supabase-Secrets, Daten liegen in der Postgres-DB). Deploy über
  GitHub Actions (`.github/workflows/deploy.yml`, Vorbild: Schwesterprojekt "CrossFit Tracker").
  **Wichtig**: `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY` müssen als Repository-
  **Variables** (Settings → Secrets and variables → Actions → Tab "Variables") hinterlegt
  werden, **nicht** als Secrets -- GitHub Actions maskiert jeden als Secret gespeicherten Wert
  überall, wo er auftaucht, auch innerhalb der gebauten Datei selbst, und macht ihn damit
  unbrauchbar (kaputte Zeichenfolge statt echtem Wert). Der anon key ist ohnehin öffentlich
  (für den Client-Code gedacht), gehört also ganz regulär als Variable dorthin.
  `public/manifest.json` braucht **relative** Pfade (`"start_url": "."`, Icons ohne führenden
  Schrägstrich) statt absoluter (`"/"`) -- sonst öffnet das vom iPhone-Home-Bildschirm
  installierte Icon die nackte GitHub-Pages-Domain statt des `/pendenzenliste/`-Unterordners.
- **Migration bestehender Daten**: einmaliges Node-Skript
  `backend/scripts/migrate-to-supabase.mjs` -- liest die alte SQLite-Datei rein lesend (über
  `backend/src/db.js`) und schreibt über `@supabase/supabase-js` (mit Service-Role-Key) nach
  Supabase. Reihenfolge wegen Fremdschlüsseln: Mandanten → Mitarbeitende-Zuordnung (per
  E-Mail an bereits im Dashboard angelegte Auth-Konten) → Regeln → Pendenzen (erst
  Hauptaufgaben, dann Teilaufgaben) → E-Mail-Verlauf → Notizen. Alte IDs werden 1:1
  übernommen (`generated by default as identity`-Spalten erlauben das, `generated always`
  nicht), ausser bei `mitarbeitende` (dort eigene IDs, siehe Datenmodell unten).
- Der frühere Node/Express/SQLite-Server (`backend/`) bleibt im Repo als Referenz/Fallback
  liegen, wird aber nicht mehr weiterentwickelt.
- Sprache der Oberfläche unverändert: Deutsch (Schweiz), keine ß-Schreibung, echte Umlaute
  (ä/ö/ü) auch in Code-Kommentaren.

## Datenmodell -- Ergänzungen/Änderungen gegenüber v3

- **`mitarbeitende`**: eigene, von `auth.users` **unabhängige** ID (nicht identisch mit der
  Supabase-Auth-User-ID) -- ein zusätzliches Feld `auth_user_id` (nullable, verweist auf
  `auth.users.id`) verknüpft optional ein Login-Konto. So bleiben Mitarbeitende **ohne** Login
  weiterhin möglich (reine Namens-Zuweisung als Bearbeiter/in), genau wie in v3 beschrieben --
  nur dass "Login setzen" jetzt heisst: im Supabase-Dashboard ein Auth-Konto mit genau
  derselben E-Mail-Adresse anlegen, der `handle_new_user`-Trigger verknüpft es automatisch.
  Passwort-Hash entfällt (Supabase Auth übernimmt das).
- **`pendenzen.geplant`** (boolean, Default `true`) -- neu, für das "Eingang"-Konzept (siehe
  eigener Abschnitt unten). `false` = liegt im Eingang, noch nicht in Cockpit/Alle Pendenzen/
  Mandanten sichtbar.
- `sitzungen` und `app_einstellungen` (SMTP-Konfigurationstabelle) entfallen ersatzlos --
  Supabase Auth übernimmt Sessions, SMTP-Zugangsdaten sind Edge-Function-Secrets.
- Alle übrigen Tabellen/Felder wie in v3 beschrieben.

## Mobile-Ansicht (neu in v4)

Eigene, bewusst schmale Ansicht fürs Handy statt der vollen Desktop-Oberfläche mit
Sidebar-Navigation (sieben Menüpunkte wären auf einem iPhone-Bildschirm nicht sinnvoll nutzbar).
`App.jsx` entscheidet anhand der Fensterbreite (`useIstHandy()`-Hook, Schwelle 640px, wie der
bestehende CSS-Breakpoint), ob die volle Desktop-Ansicht oder `MobilApp` gerendert wird.

`MobilApp` hat genau zwei Tabs, keine weitere Navigation:

1. **"+ Erfassen"** (`MobilErfassen`): nur Titel + Bemerkung, ein Speichern-Button. Nach dem
   Speichern bleibt das Formular offen und leer für die nächste Erfassung (unterwegs mehrere
   Dinge hintereinander aufnotieren). Landet mit `geplant:false` im **Eingang** (siehe unten) --
   Mandant, Priorität, echte Fälligkeit usw. werden bewusst nicht abgefragt, das passiert erst
   beim Einplanen am PC.
2. **"Kalender"** (`MobilKalender`): derselbe Monatskalender wie im Desktop-Cockpit
   (`Faelligkeitskalender`-Komponente, wiederverwendet), rein zum Nachschauen, was ansteht --
   Tag antippen zeigt die fälligen Pendenzen, antippen öffnet bei Bedarf das volle
   Bearbeiten-Fenster.

Der bestehende Desktop-Zoom-Mechanismus (`document.documentElement.style.zoom`, siehe
"Responsives Layout" in v3) wird auf Handybreite komplett übersprungen (`--app-zoom`-
CSS-Variable bleibt auf `1`) -- die Handy-Ansicht ist für ihre Breite von Grund auf entworfen,
statt vom Zoom-Ausgleich für Desktop-/Laptop-Fenstergrössen betroffen zu sein.

**Wichtige, in dieser Session gefundene Falle**: der `zoom`-Mechanismus verträgt sich nicht mit
`flex-grow`/`flex: 1`-basierter Höhenverteilung (ein Container mit `flex:1` kollabiert unter
`zoom != 1` auf seine Kopfzeile statt den verfügbaren Platz zu füllen -- reproduzierbarer
Browser-Bug). vh-basierte `calc()`-Ausdrücke (z.B. `calc(30vh / var(--app-zoom))`) bleiben
dagegen korrekt. Wo im Desktop-Layout etwas von der Fenstergrösse abhängen soll (z.B. die
Höhenbegrenzung der Fälligkeiten-Liste im Cockpit, damit die Kalenderkarte darunter ohne
Seiten-Scroll sichtbar bleibt), **immer** vh+calc verwenden, nie flex-grow, solange der
Zoom-Mechanismus aktiv ist.

## Eingang (neu in v4)

Sammelbecken für unterwegs per Handy erfasste Notizen, bevor sie einem Mandanten/einer echten
Fälligkeit zugeordnet sind:

- Jede neu erstellte Pendenz hat `geplant:true` per Default -- **ausser** die
  Mobil-Erfassen-Ansicht, die explizit `geplant:false` setzt.
- Alle Listen-Abfragen (Cockpit-RPC, `api.pendenzen.liste(...)` und damit Alle Pendenzen/
  Mandanten/Archiv/Kalender, Mandanten-Übersicht-RPC) filtern implizit auf `geplant = true` --
  eine Eingang-Notiz taucht nirgends sonst auf.
- Eigene Desktop-Ansicht **"Eingang"** (eigener Sidebar-Eintrag, zwischen Cockpit und Alle
  Pendenzen): einfache Liste (Titel, Bemerkung, Erfassungszeitpunkt), Klick öffnet das normale
  Bearbeiten-Fenster. Ein vollständiges Speichern dort (egal welche Felder geändert wurden)
  setzt `geplant` automatisch auf `true` -- die Notiz verschwindet aus dem Eingang und
  erscheint ab sofort ganz normal überall.
- Kein separater Toggle/Button nötig, um etwas "einzuplanen" -- das Öffnen + Speichern im
  bestehenden Bearbeiten-Formular reicht (Mandant/Fälligkeit/Priorität dort wie gewohnt setzen).

## Authentifizierung (v4 -- ersetzt den Abschnitt aus v3)

- Supabase Auth statt eigenem Cookie/Session-Mechanismus. `AuthGate.jsx` nutzt
  `supabase.auth.getSession()` + `onAuthStateChange`, um Login-Zustand und die zugehörige
  `mitarbeitende`-Profilzeile (Name/E-Mail fürs UI) zu laden.
- **Kein** "Passwort erstmalig festlegen"/Selbstregistrierung mehr -- `Login.jsx` ist reines
  Sign-in (`supabase.auth.signInWithPassword`). Neue Konten werden ausschliesslich im
  Supabase-Dashboard angelegt (siehe Datenmodell-Abschnitt oben).
- Abmelden über `supabase.auth.signOut()`.

## E-Mail und Kalender (v4 -- ersetzt den Abschnitt aus v3)

- E-Mail-Versand über die Edge Function `send-mail` (siehe "Technischer Rahmen" oben) statt
  `nodemailer` direkt im Node-Prozess. Gleiche Funktionalität wie in v3 beschrieben (Anhang als
  `.ics`, Protokollierung in `pendenz_emails`, Testmail-Button in den Einstellungen) --
  `api.mail.senden`/`api.mail.test` in `frontend/src/api.js` bauen den Request und rufen die
  Function per `supabase.functions.invoke(...)` auf; die Protokollzeile in `pendenz_emails`
  schreibt das Frontend danach selbst (unter RLS, nicht die Function).
- `.ics`-Erzeugung und Download laufen jetzt komplett clientseitig (`frontend/src/lib/ics.js`,
  identische Logik wie das frühere `backend/src/ics.js`) über einen `Blob`/
  `URL.createObjectURL`-Download statt eines Server-Endpunkts -- kein `GET /api/pendenzen/:id/ics`
  mehr nötig.
- Die "Einstellungen"-Seite hat kein editierbares SMTP-Formular mehr (Zugangsdaten sind
  Edge-Function-Secrets, nicht in der App änderbar) -- nur noch den Testmail-Button und
  Hinweistext.

## Offene Punkte (Stand Ende dieser Migration, noch zu tun)

1. **Automatische Wiederkehr-Regel-Generierung**: der tägliche `setInterval`-Lauf aus
   `backend/src/server.js` hat noch kein Supabase-Äquivalent. Ohne das entstehen **keine**
   neuen wiederkehrenden Pendenzen (MWST, Lohnläufe usw.) mehr automatisch. Geplanter Ansatz:
   `recurrence.js`/`generate.js`-Logik (liegt schon portiert als reine Funktionen in
   `frontend/src/lib/recurrence.js`) als zweite Edge Function
   (`supabase/functions/generate-pendenzen`), täglich ausgelöst über einen Supabase
   Cron-Trigger (`pg_cron` + `net.http_post` auf die Function-URL).
2. **Mandanten-Erweiterungen**: Löschen/Archivieren-Button im Mandant-Bearbeiten-Fenster (gibt
   es bisher gar nicht, auch nicht in v1-v3 -- Mandanten liessen sich nur auf "Inaktiv" setzen);
   ein zusätzlicher Status "Potenziell" für Interessenten, die noch keine aktiven Mandanten
   sind.
3. Eigene Domain (`pendenzen.estcontrolling.ch`) statt der `github.io`-Adresse wurde nicht
   umgesetzt (aktuell: `https://<github-username>.github.io/pendenzenliste/`) -- bei Bedarf per
   CNAME-Eintrag beim Domain-Anbieter + `Settings → Pages → Custom domain` nachrüstbar.
4. Der Docker/Caddy-Betrieb (`Dockerfile`, `docker-compose.yml`, `Caddyfile`) und die
   HOSTING.md-Anleitung beziehen sich noch auf den alten Node-Server und sind mit dieser
   Migration nicht mehr der empfohlene Weg -- als Referenz belassen, nicht aktualisiert.

## Vorgehen bei einer Neuinstallation (Supabase-Variante)

1. Supabase-Projekt anlegen (Region EU wegen Mandantendaten), `supabase/schema.sql` im
   SQL-Editor ausführen, öffentliche Registrierung in den Auth-Einstellungen deaktivieren.
2. Login-Konten im Dashboard anlegen (User Metadata `{"name": "..."}` mitgeben), die
   `mitarbeitende`-Zeilen entstehen automatisch über den `handle_new_user`-Trigger.
3. Edge Function `send-mail` über den Dashboard-Editor anlegen (Code aus
   `supabase/functions/send-mail/index.ts`), SMTP-Zugangsdaten als Function-Secrets hinterlegen.
4. Frontend: `frontend/.env.local` mit `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` anlegen
   (siehe `.env.local.example`), `npm run dev` zum lokalen Testen.
5. GitHub-Repository anlegen (öffentlich, siehe oben warum), `git push`, unter
   `Settings → Pages` "GitHub Actions" als Quelle wählen, die zwei Werte aus Schritt 4 als
   Repository-**Variables** (nicht Secrets!) hinterlegen, Workflow einmal manuell auslösen.
6. Bei bestehenden Altdaten: `backend/scripts/migrate-to-supabase.mjs` einmalig lokal ausführen
   (Service-Role-Key in eine lokale, nicht versionierte Datei legen, siehe Kommentar im Skript).

Für alles, was hier nicht erwähnt ist (Datumslogik, Status-Kaskade-Verhalten, Tabellen-/
Layout-Design, Bedienung, Tastenkürzel, Detailansicht-Felder), gilt `prompt-pendenzenliste-v3.md`
unverändert weiter.
