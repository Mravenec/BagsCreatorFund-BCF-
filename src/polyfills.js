import { Buffer } from 'buffer';

window.Buffer = Buffer;
// global is handled by define: { global: 'window' } in vite.config.js
