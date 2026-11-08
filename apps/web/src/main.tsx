import { cssVariables } from '@puntuale/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './styles.css';

const tokens = document.createElement('style');
tokens.textContent = cssVariables();
document.head.append(tokens);

const root = document.getElementById('root');
if (!root) throw new Error('No existe #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
