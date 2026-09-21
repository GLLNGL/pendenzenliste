import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import MobilApp from './components/MobilApp.jsx';
import Cockpit from './views/Cockpit.jsx';
import Eingang from './views/Eingang.jsx';
import AllePendenzen from './views/AllePendenzen.jsx';
import Mandanten from './views/Mandanten.jsx';
import Regeln from './views/Regeln.jsx';
import Archiv from './views/Archiv.jsx';
import Team from './views/Team.jsx';
import Einstellungen from './views/Einstellungen.jsx';
import { useIstHandy } from './hooks.js';

export default function App() {
  const istHandy = useIstHandy();
  if (istHandy) return <MobilApp />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Cockpit />} />
        <Route path="/eingang" element={<Eingang />} />
        <Route path="/pendenzen" element={<AllePendenzen />} />
        <Route path="/mandanten" element={<Mandanten />} />
        <Route path="/regeln" element={<Regeln />} />
        <Route path="/archiv" element={<Archiv />} />
        <Route path="/team" element={<Team />} />
        <Route path="/einstellungen" element={<Einstellungen />} />
      </Route>
    </Routes>
  );
}
