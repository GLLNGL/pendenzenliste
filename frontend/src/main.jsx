import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
// Schrift lokal mit der App ausgeliefert (kein Abruf bei Google Fonts).
import '@fontsource-variable/inter';
import './index.css';
import App from './App.jsx';
import AuthGate from './components/AuthGate.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <AuthGate>
        <App />
      </AuthGate>
    </HashRouter>
  </StrictMode>,
);
