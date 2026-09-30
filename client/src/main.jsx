import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { setupAxeAudit } from './utils/accessibility.js';
import { registerSW } from 'virtual:pwa-register';

setupAxeAudit();

if (import.meta.env.PROD) {
  let refreshingForUpdate = false;
  registerSW({
    immediate: true,
    onRegisteredSW: (_workerUrl, registration) => registration?.update(),
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshingForUpdate) return;
      refreshingForUpdate = true;
      window.location.reload();
    });
  }
} else if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    registrations.forEach(registration => registration.unregister());
  });
  if (window.caches) {
    caches.keys().then(keys => keys.forEach(key => caches.delete(key)));
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
