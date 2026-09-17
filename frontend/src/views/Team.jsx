import { useState } from 'react';
import { useMitarbeitende } from '../hooks.js';
import MitarbeiterModal from '../components/MitarbeiterModal.jsx';

export default function Team() {
  const mitarbeitende = useMitarbeitende();
  const [bearbeiteter, setBearbeiteter] = useState(null);
  const [neuOffen, setNeuOffen] = useState(false);

  return (
    <div>
      <h1 className="seiten-titel">Team</h1>
      <p className="seiten-untertitel">Mitarbeitende, die Pendenzen als Bearbeiter/in zugewiesen werden können.</p>

      <div className="filter-leiste">
        <button type="button" className="btn" onClick={() => setNeuOffen(true)}>+ Neue/r Mitarbeiter/in</button>
      </div>

      <div className="karte">
        <table className="tabelle">
          <thead>
            <tr>
              <th>Name</th>
              <th>E-Mail</th>
              <th>Login</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {mitarbeitende.map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td>{m.email || '–'}</td>
                <td>{m.login_aktiv ? '🔑 aktiv' : <span className="tag-inaktiv">kein Login</span>}</td>
                <td>{m.aktiv ? 'Aktiv' : <span className="tag-inaktiv">INAKTIV</span>}</td>
                <td className="spalte-aktionen">
                  <button type="button" className="btn-klein" onClick={() => setBearbeiteter(m)}>Bearbeiten</button>
                </td>
              </tr>
            ))}
            {mitarbeitende.length === 0 && (
              <tr><td colSpan={5} className="leer-hinweis">Noch keine Mitarbeitenden erfasst.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {bearbeiteter && (
        <MitarbeiterModal
          mitarbeiter={bearbeiteter}
          onSchliessen={() => setBearbeiteter(null)}
          onGespeichert={() => setBearbeiteter(null)}
          onGeloescht={() => setBearbeiteter(null)}
        />
      )}
      {neuOffen && (
        <MitarbeiterModal
          mitarbeiter={null}
          onSchliessen={() => setNeuOffen(false)}
          onGespeichert={() => setNeuOffen(false)}
          onGeloescht={() => setNeuOffen(false)}
        />
      )}
    </div>
  );
}
