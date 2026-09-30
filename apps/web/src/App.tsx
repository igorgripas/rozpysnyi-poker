import { useEffect, useState } from 'react';
import { GameTable } from './game/GameTable';
import { uk } from './i18n';
import { Lobby } from './lobby/Lobby';
import { WaitingRoom } from './lobby/WaitingRoom';
import { type PokerClient, inviteCodeFromPath } from './net/client';
import { ClientProvider, useClientState } from './net/react';
import { CardFace } from './ui/Card';
import { ThemeProvider, ThemeToggle } from './ui/theme';

/** Каркас застосунку: шапка й основна область. */
export function App({ client }: { client: PokerClient }) {
  return (
    <ThemeProvider>
      <ClientProvider client={client}>
        <div className="app">
          <header className="app__header">
            <h1 className="app__title">{uk.appTitle}</h1>
            <ThemeToggle />
          </header>
          <main className="app__main">
            <Screen client={client} />
          </main>
        </div>
      </ClientProvider>
    </ThemeProvider>
  );
}

/** Екран за станом: лобі, кімната очікування або гра. */
function Screen({ client }: { client: PokerClient }) {
  const { status, room, view } = useClientState();
  const [inviteCode, setInviteCode] = useState(() => inviteCodeFromPath(window.location.pathname));

  // Повертаємося в кімнату за збереженим токеном; запрошення в іншу кімнату його не використовує.
  useEffect(() => {
    void client.resume(inviteCodeFromPath(window.location.pathname) ?? undefined);
  }, [client]);

  // Адреса сторінки — посилання на поточну кімнату: його можна скопіювати або оновити сторінку.
  const code = room?.code ?? null;
  useEffect(() => {
    if (code !== null) window.history.replaceState(null, '', `/r/${code}`);
  }, [code]);

  if (room !== null) {
    if (room.status === 'lobby') return <WaitingRoom room={room} />;
    return view === null ? (
      <p className="muted">{uk.game.dealing}</p>
    ) : (
      <GameTable room={room} view={view} />
    );
  }
  if (status === 'resuming') return <p className="muted">{uk.lobby.resuming}</p>;
  return (
    <div className="home">
      <div className="home__cards" aria-hidden="true">
        <CardFace card={{ kind: 'standard', suit: 'spades', rank: 14 }} />
        <CardFace card={{ kind: 'standard', suit: 'hearts', rank: 13 }} />
        <CardFace card={{ kind: 'joker', index: 0 }} />
      </div>
      <p className="home__tagline">{uk.home.tagline}</p>
      <Lobby
        inviteCode={inviteCode}
        onForgetInvite={() => {
          window.history.replaceState(null, '', '/');
          setInviteCode(null);
        }}
      />
    </div>
  );
}
