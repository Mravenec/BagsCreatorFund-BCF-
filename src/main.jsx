/**
 * BAGSFund - Manual Entry Point Polyfills
 * Required for @coral-xyz/anchor on Windows environments
 */
import { Buffer } from 'buffer';
window.Buffer = Buffer;
window.global = window;
window.process = {
  env: {
    NODE_ENV: import.meta.env.MODE
  },
  version: '',
  nextTick: (cb) => setTimeout(cb, 0)
};

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
