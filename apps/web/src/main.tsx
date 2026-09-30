import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PokerClient } from './net/client';
import { createSocketConnection } from './net/connection';
import { serverUrl } from './net/serverUrl';
import { registerServiceWorker } from './pwa';
import './styles.css';

const url = serverUrl(window.location.search, {
  dev: import.meta.env.DEV,
  configured: import.meta.env.VITE_SERVER_URL as string | undefined,
});
const client = new PokerClient(createSocketConnection(url));

registerServiceWorker();

const root = document.getElementById('root');
if (root === null) throw new Error('Немає елемента #root');
createRoot(root).render(
  <StrictMode>
    <App client={client} />
  </StrictMode>,
);
