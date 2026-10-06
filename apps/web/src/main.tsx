import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { trickPauseFromSearch } from './game/trickPause';
import { PokerClient } from './net/client';
import { createSocketConnection } from './net/connection';
import { reloadForNewVersion, wakeServer } from './net/restart';
import { serverUrl } from './net/serverUrl';
import { registerServiceWorker } from './pwa';
import { AppUpdates } from './update';
import './styles.css';

const url = serverUrl(window.location.search, {
  dev: import.meta.env.DEV,
  configured: import.meta.env.VITE_SERVER_URL as string | undefined,
});
void wakeServer(url);
const client = new PokerClient(createSocketConnection(url));
const updates = new AppUpdates();
// Сервер оновився до нової версії протоколу: беремо новий клієнт (і новий service worker,
// якщо він уже встановився), токен зберігається.
client.subscribe(() => {
  if (client.getState().connection === 'outdated') {
    reloadForNewVersion(sessionStorage, () => updates.apply());
  }
});
const trickPauseMs = trickPauseFromSearch(window.location.search, import.meta.env.DEV);

registerServiceWorker(import.meta.env.PROD, navigator.serviceWorker, updates);

const root = document.getElementById('root');
if (root === null) throw new Error('Немає елемента #root');
createRoot(root).render(
  <StrictMode>
    <App client={client} trickPauseMs={trickPauseMs} updates={updates} />
  </StrictMode>,
);
