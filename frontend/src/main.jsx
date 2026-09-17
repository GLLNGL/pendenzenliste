import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
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
