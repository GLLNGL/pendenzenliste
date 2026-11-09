import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import MobilApp from './components/MobilApp.jsx';
import Cockpit from './views/Cockpit.jsx';
import TagesCockpit from './views/TagesCockpit.jsx';
import ZuPlanen from './views/ZuPlanen.jsx';
import Eingang from './views/Eingang.jsx';
import AllePendenzen from './views/AllePendenzen.jsx';
import Mandanten from './views/Mandanten.jsx';
import OnboardingUnterlagen from './views/OnboardingUnterlagen.jsx';
import Belege from './views/Belege.jsx';
import Liquiditaet from './views/Liquiditaet.jsx';
import Regeln from './views/Regeln.jsx';
import Archiv from './views/Archiv.jsx';
import Wochenrueckblick from './views/Wochenrueckblick.jsx';
import Team from './views/Team.jsx';
import Einstellungen from './views/Einstellungen.jsx';
import Preise from './views/Preise.jsx';
import Start from './views/Start.jsx';
import Zeitjournal from './views/Zeitjournal.jsx';
import Rapporte from './views/Rapporte.jsx';
import RapportEditor from './views/RapportEditor.jsx';
import Offerten from './views/Offerten.jsx';
import OffertEditor from './views/OffertEditor.jsx';
import { useIstHandy } from './hooks.js';

export default function App() {
  const istHandy = useIstHandy();
  if (istHandy) return <MobilApp />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<TagesCockpit />} />
        <Route path="/uebersicht" element={<Cockpit />} />
        <Route path="/planen" element={<ZuPlanen />} />
        <Route path="/start" element={<Start />} />
        <Route path="/eingang" element={<Eingang />} />
        <Route path="/pendenzen" element={<AllePendenzen />} />
        <Route path="/mandanten" element={<Mandanten />} />
        <Route path="/onboarding-unterlagen" element={<OnboardingUnterlagen />} />
        <Route path="/regeln" element={<Regeln />} />
        <Route path="/wochenrueckblick" element={<Wochenrueckblick />} />
        <Route path="/archiv" element={<Archiv />} />
        <Route path="/offerten" element={<Offerten />} />
        <Route path="/offerten/:id" element={<OffertEditor />} />
        <Route path="/preise" element={<Preise />} />
        <Route path="/zeit" element={<Zeitjournal />} />
        <Route path="/rapporte" element={<Rapporte />} />
        <Route path="/rapporte/:id" element={<RapportEditor />} />
        <Route path="/kreditoren" element={<Belege key="kreditor" art="kreditor" />} />
        <Route path="/debitoren" element={<Belege key="debitor" art="debitor" />} />
        <Route path="/liquiditaet" element={<Liquiditaet />} />
        <Route path="/team" element={<Team />} />
        <Route path="/einstellungen" element={<Einstellungen />} />
      </Route>
    </Routes>
  );
}
