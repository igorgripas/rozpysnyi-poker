import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PokerClient } from './net/client';
import { createSocketConnection } from './net/connection';
import './styles.css';

// Адреса сервера: VITE_SERVER_URL або той самий хост (dev-проксі Vite).
const serverUrl = import.meta.env.VITE_SERVER_URL as string | undefined;
const client = new PokerClient(createSocketConnection(serverUrl || undefined));

const root = document.getElementById('root');
if (root === null) throw new Error('Немає елемента #root');
createRoot(root).render(
  <StrictMode>
    <App client={client} />
  </StrictMode>,
);
