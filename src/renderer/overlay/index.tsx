import React from 'react';
import { createRoot } from 'react-dom/client';
import { SubtitleOverlay } from './SubtitleOverlay';
import './styles.css';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <SubtitleOverlay />
    </React.StrictMode>
  );
}
