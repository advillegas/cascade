import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

// Polyfill window.storage (Claude Chat sandbox API) with localStorage
if (typeof window !== 'undefined' && !window.storage) {
  window.storage = {
    get: (key) => {
      try { return Promise.resolve(window.localStorage.getItem(key)); }
      catch { return Promise.resolve(null); }
    },
    set: (key, value) => {
      try { window.localStorage.setItem(key, value); return Promise.resolve(); }
      catch { return Promise.resolve(); }
    },
    delete: (key) => {
      try { window.localStorage.removeItem(key); return Promise.resolve(); }
      catch { return Promise.resolve(); }
    },
  };
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
