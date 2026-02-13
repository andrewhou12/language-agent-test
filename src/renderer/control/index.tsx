import React from 'react';
import { createRoot } from 'react-dom/client';
import { ControlPanel } from './ControlPanel';
import './styles.css';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <ControlPanel />
    </React.StrictMode>
  );
}
