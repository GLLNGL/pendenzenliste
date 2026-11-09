import { useEffect, useState, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import ModulNavigation from './ModulNavigation.jsx';
import api from '../api.js';
import PendenzModal from './PendenzModal.jsx';
import TimerLeiste from './TimerLeiste.jsx';
import { aufMandantenAenderungHoeren, aufMitarbeitendeAenderungHoeren, aufAenderungHoeren, meldeAenderung } from '../events.js';
import { useAuth } from '../AuthContext.jsx';
import { heutigesDatumISO } from '../format.js';

const WIEDERKEHR_SCHLUESSEL = 'wiederkehr-zuletzt-erzeugt';
const NAV_SCHLUESSEL = 'seitenleiste-breite';
const NAV_STANDARD = 208;
const NAV_MIN = 180;
const NAV_MAX = 520;


function editierbaresElementFokussiert() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export default function Layout() {
  const { benutzer, abmelden } = useAuth();
  const [mandanten, setMandanten] = useState([]);
  const [mitarbeitende, setMitarbeitende] = useState([]);
  const [schnellErfassungOffen, setSchnellErfassungOffen] = useState(false);
  const [eingangAnzahl, setEingangAnzahl] = useState(0);
  const [navBreite, setNavBreite] = useState(() => {
    try { return Number(localStorage.getItem(NAV_SCHLUESSEL)) || NAV_STANDARD; } catch { return NAV_STANDARD; }
  });

  const ladeMandanten = useCallback(() => {
    api.mandanten.liste().then(setMandanten).catch(() => {});
  }, []);

  const ladeMitarbeitende = useCallback(() => {
    api.mitarbeitende.liste().then(setMitarbeitende).catch(() => {});
  }, []);

  useEffect(() => {
    ladeMandanten();
    return aufMandantenAenderungHoeren(ladeMandanten);
  }, [ladeMandanten]);

  useEffect(() => {
    ladeMitarbeitende();
    return aufMitarbeitendeAenderungHoeren(ladeMitarbeitende);
  }, [ladeMitarbeitende]);

  const ladeEingangAnzahl = useCallback(() => {
    api.pendenzen.eingangAnzahl().then(setEingangAnzahl).catch(() => {});
  }, []);

  useEffect(() => {
    ladeEingangAnzahl();
    return aufAenderungHoeren(ladeEingangAnzahl);
  }, [ladeEingangAnzahl]);

  // Wiederkehrende Mandatsarbeiten entstehen automatisch mit Vorlauf: einmal pro Tag (beim
  // ersten Oeffnen der App) alles erzeugen, was bis heute erscheint. Doppelt kann nichts
  // entstehen -- die Datenbank laesst bereits vorhandene Regel/Periode-Kombinationen aus, auch
  // wenn beide Personen die App gleichzeitig oeffnen.
  useEffect(() => {
    const heute = heutigesDatumISO();
    let zuletzt = null;
    try { zuletzt = localStorage.getItem(WIEDERKEHR_SCHLUESSEL); } catch { /* ohne Speicher: jedes Mal */ }
    if (zuletzt === heute) return;
    api.regeln.erzeugen(heute).then((neu) => {
      try { localStorage.setItem(WIEDERKEHR_SCHLUESSEL, heute); } catch { /* ohne Speicher weiter nutzbar */ }
      if (neu.length) meldeAenderung();
    }).catch(() => { /* naechster Versuch beim naechsten Oeffnen */ });
  }, []);

  // Auftraege per E-Mail beim Oeffnen der App abholen (hoechstens alle 15 Minuten, still --
  // Fehler zeigt der Eingang selbst an).
  useEffect(() => {
    const SCHLUESSEL = 'mail-eingang-zuletzt';
    let zuletzt = 0;
    try { zuletzt = Number(localStorage.getItem(SCHLUESSEL)) || 0; } catch { /* ohne Speicher: jedes Mal */ }
    if (Date.now() - zuletzt < 15 * 60 * 1000) return;
    try { localStorage.setItem(SCHLUESSEL, String(Date.now())); } catch { /* ohne Speicher weiter */ }
    api.mail.eingangAbholen().then((r) => { if (r?.neu) meldeAenderung(); }).catch(() => {});
  }, []);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'n' && !editierbaresElementFokussiert() && !schnellErfassungOffen) {
        e.preventDefault();
        setSchnellErfassungOffen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [schnellErfassungOffen]);

  // Ziehgriff am rechten Rand der Seitenleiste: Breite per Maus aendern (gemerkt pro Geraet),
  // Doppelklick stellt die Standardbreite wieder her.
  function breiteZiehen(e) {
    e.preventDefault();
    const leiste = e.currentTarget.parentElement;
    const rechteck = leiste.getBoundingClientRect();
    // Verhaeltnis Bildschirm- zu CSS-Pixeln (die App ist per CSS-Zoom skaliert).
    const faktor = rechteck.width / leiste.offsetWidth || 1;
    let letzte = navBreite;
    function bewegen(ev) {
      letzte = Math.round(Math.min(NAV_MAX, Math.max(NAV_MIN, (ev.clientX - rechteck.left) / faktor)));
      setNavBreite(letzte);
    }
    function loslassen() {
      window.removeEventListener('pointermove', bewegen);
      window.removeEventListener('pointerup', loslassen);
      document.body.classList.remove('nav-zieht');
      try { localStorage.setItem(NAV_SCHLUESSEL, String(letzte)); } catch { /* ohne Speicher weiter */ }
    }
    document.body.classList.add('nav-zieht');
    window.addEventListener('pointermove', bewegen);
    window.addEventListener('pointerup', loslassen);
  }
  function breiteZuruecksetzen() {
    setNavBreite(NAV_STANDARD);
    try { localStorage.removeItem(NAV_SCHLUESSEL); } catch { /* ohne Speicher weiter */ }
  }

  return (
    <div className="app-layout" style={{ '--nav-breite': `${navBreite}px` }}>
      <aside className="sidebar">
        <div
          className="sidebar-griff"
          role="separator"
          aria-orientation="vertical"
          aria-label="Breite der Seitenleiste ändern"
          title="Ziehen: Breite ändern · Doppelklick: Standardbreite"
          onPointerDown={breiteZiehen}
          onDoubleClick={breiteZuruecksetzen}
        />
        <ModulNavigation zaehler={{ '/eingang': eingangAnzahl }} />
        <div className="sidebar-fuss">
          <TimerLeiste />
          <button type="button" className="btn-neu" onClick={() => setSchnellErfassungOffen(true)}>
            <span>+ Neue Pendenz</span>
            <span className="taste">n</span>
          </button>
          {benutzer && (
            <div className="sidebar-benutzer">
              <span className="sidebar-benutzer-name">{benutzer.name}</span>
              <button type="button" className="sidebar-abmelden" onClick={abmelden}>Abmelden</button>
            </div>
          )}
        </div>
      </aside>

      <main className="hauptbereich">
        <Outlet />
      </main>

      {schnellErfassungOffen && (
        <PendenzModal
          pendenz={null}
          mandanten={mandanten}
          mitarbeitende={mitarbeitende}
          onSchliessen={() => setSchnellErfassungOffen(false)}
          onGespeichert={() => setSchnellErfassungOffen(false)}
          onGeloescht={() => setSchnellErfassungOffen(false)}
        />
      )}
    </div>
  );
}
