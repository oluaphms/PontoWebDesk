
import React from 'react';
import ReactDOM from 'react-dom/client';
import { initSentry } from './lib/sentry';
import { ThemeService } from './services/themeService';
import { i18n } from './lib/i18n';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

initSentry();
ThemeService.init();
i18n.init();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error("Could not find root element to mount to");

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
