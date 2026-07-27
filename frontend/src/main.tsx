import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from './theme/ThemeProvider';
import { App } from './App';

// Order matters: tokens define the custom properties that global.css and every
// CSS module then reference.
import './theme/tokens.css';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('No #root element in the page; index.html is missing its mount point.');
}

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
