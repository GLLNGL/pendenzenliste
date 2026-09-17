import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import AuthContext from '../AuthContext.jsx';
import Login from './Login.jsx';
import { HANDY_SCHWELLE } from '../hooks.js';

// Umschliesst die App: zeigt Login, solange niemand angemeldet ist. Keine eigene
// Ersteinrichtung/Selbstregistrierung mehr -- Login-Konten werden nur im Supabase-Dashboard
// angelegt (siehe Migrationsplan Phase 2), darum reicht hier ein einzelner Login-Bildschirm.
export default function AuthGate({ children }) {
  const [zustand, setZustand] = useState('laedt'); // laedt | login | angemeldet
  const [benutzer, setBenutzer] = useState(null);

  // Nach jeder Session-Aenderung (Login, Logout, Token-Refresh) die passende
  // mitarbeitende-Profilzeile nachladen -- benutzer.name/email im Rest der App sollen aus
  // dieser Zeile kommen, nicht nur aus der rohen Auth-Session.
  const ladeProfil = useCallback(async (session) => {
    if (!session) {
      setBenutzer(null);
      setZustand('login');
      return;
    }
    const { data } = await supabase.from('mitarbeitende')
      .select('id, name, email').eq('auth_user_id', session.user.id).maybeSingle();
    setBenutzer(data
      ? { id: data.id, name: data.name, email: data.email }
      : { id: null, name: session.user.email, email: session.user.email });
    setZustand('angemeldet');
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => ladeProfil(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      ladeProfil(session);
    });
    return () => listener.subscription.unsubscribe();
  }, [ladeProfil]);

  // Skaliert die ganze App wie eine Browser-Zoomstufe zur Fenstergroesse -- gleiches Layout,
  // nur groesser/kleiner dargestellt, statt dass Spalten umbrechen oder Text abgeschnitten wird
  // (so wie es Outlook & Co. auch machen). Auf einem grossen Bildschirm darf die Ansicht ruhig
  // groesser als 100% werden, auf einem Laptop-Display entsprechend kleiner. window.outerWidth
  // (physische Fenstergroesse) statt innerWidth, weil innerWidth durch den gesetzten CSS-Zoom
  // selbst rueckwirkend beeinflusst wuerde und sich sonst bei jedem Resize-Event aufschaukeln
  // koennte.
  useEffect(() => {
    const REFERENZ_BREITE = 1700; // Fensterbreite, fuer die die App bei Zoom 100% entworfen ist
    const MIN_ZOOM = 0.7; // ab hier uebernimmt das horizontale Scrollen statt weiter zu schrumpfen
    const MAX_ZOOM = 1.3; // auf sehr breiten Monitoren nicht unbegrenzt weiter vergroessern

    function zoomAnpassen() {
      const breite = window.outerWidth || window.innerWidth;
      // Handys bekommen die eigene MobilApp (App.jsx), die schon fuer ihre Breite entworfen ist --
      // dort soll der Zoom-Ausgleich fuer Desktop/Laptop-Fenstergroessen nicht zusaetzlich
      // hineinfunken.
      if (window.innerWidth <= HANDY_SCHWELLE) {
        document.documentElement.style.zoom = 1;
        document.documentElement.style.setProperty('--app-zoom', '1');
        return;
      }
      const faktor = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, breite / REFERENZ_BREITE));
      document.documentElement.style.zoom = faktor;
      // CSS braucht den Faktor auch als Variable, um vh-basierte Groessen (Dialoge, Login-Seite)
      // dagegen zu korrigieren -- siehe Kommentar bei --app-zoom in index.css.
      document.documentElement.style.setProperty('--app-zoom', String(faktor));
    }

    zoomAnpassen();
    window.addEventListener('resize', zoomAnpassen);
    return () => window.removeEventListener('resize', zoomAnpassen);
  }, []);

  const abmelden = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  if (zustand === 'laedt') return <div className="ladeindikator" style={{ padding: 40 }}>Lade…</div>;

  if (zustand === 'login') return <Login />;

  return (
    <AuthContext.Provider value={{ benutzer, abmelden }}>
      {children}
    </AuthContext.Provider>
  );
}
