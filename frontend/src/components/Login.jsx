import { useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';

// Reines Sign-in -- keine Selbstregistrierung (Konten werden nur im Supabase-Dashboard
// angelegt). Nach erfolgreichem Login uebernimmt AuthGate's onAuthStateChange-Listener den
// Wechsel zur App automatisch, darum ruft dieses Formular keinen Callback selbst auf.
export default function Login() {
  const [email, setEmail] = useState('');
  const [passwort, setPasswort] = useState('');
  const [fehler, setFehler] = useState(null);
  const [laedt, setLaedt] = useState(false);

  async function absenden(e) {
    e.preventDefault();
    setLaedt(true);
    setFehler(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: passwort });
    if (error) {
      setFehler(error.message === 'Invalid login credentials' ? 'E-Mail oder Passwort ist falsch.' : error.message);
      setLaedt(false);
    }
  }

  return (
    <div className="login-seite">
      <div className="login-box">
        <div className="login-titel">Pendenzenliste</div>
        <p className="login-untertitel">Bitte mit deiner E-Mail-Adresse anmelden.</p>
        <form onSubmit={absenden}>
          <div className="feld">
            <label htmlFor="login-email">E-Mail-Adresse</label>
            <input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus required />
          </div>
          <div className="feld">
            <label htmlFor="login-passwort">Passwort</label>
            <input id="login-passwort" type="password" value={passwort} onChange={(e) => setPasswort(e.target.value)} autoComplete="current-password" required />
          </div>
          {fehler && <div className="hinweis-fehler">{fehler}</div>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: 4 }} disabled={laedt}>
            {laedt ? 'Anmelden…' : 'Anmelden'}
          </button>
        </form>
      </div>
    </div>
  );
}
