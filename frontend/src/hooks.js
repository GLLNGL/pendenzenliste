import { useCallback, useEffect, useState } from 'react';
import api from './api.js';
import { aufMandantenAenderungHoeren, aufMitarbeitendeAenderungHoeren } from './events.js';

function useMandanten() {
  const [mandanten, setMandanten] = useState([]);
  const laden = useCallback(() => {
    api.mandanten.liste().then(setMandanten).catch(() => {});
  }, []);
  useEffect(() => {
    laden();
    return aufMandantenAenderungHoeren(laden);
  }, [laden]);
  return mandanten;
}

function useMitarbeitende() {
  const [mitarbeitende, setMitarbeitende] = useState([]);
  const laden = useCallback(() => {
    api.mitarbeitende.liste().then(setMitarbeitende).catch(() => {});
  }, []);
  useEffect(() => {
    laden();
    return aufMitarbeitendeAenderungHoeren(laden);
  }, [laden]);
  return mitarbeitende;
}

// Handy-Schwelle -- an dieser Breite haengen auch die CSS-Media-Queries (index.css) und die
// Zoom-Anpassung in AuthGate.jsx. Auf Handybreite zeigt App.jsx statt der Desktop-Ansicht die
// eigene, aufs Erfassen zugeschnittene MobilApp.
const HANDY_SCHWELLE = 640;

function useIstHandy() {
  const [istHandy, setIstHandy] = useState(() => window.matchMedia(`(max-width: ${HANDY_SCHWELLE}px)`).matches);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${HANDY_SCHWELLE}px)`);
    const aendern = (e) => setIstHandy(e.matches);
    mq.addEventListener('change', aendern);
    return () => mq.removeEventListener('change', aendern);
  }, []);
  return istHandy;
}

export { useMandanten, useMitarbeitende, useIstHandy, HANDY_SCHWELLE };
