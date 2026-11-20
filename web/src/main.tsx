import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// The Phosphor CRT fonts, bundled (no request to Google): VT323 for the brand and headings, JetBrains Mono for labels
import '@fontsource/vt323/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
