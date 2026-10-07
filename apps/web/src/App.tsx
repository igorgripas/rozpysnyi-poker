import { useEffect, useState } from 'react';
import { GameTable } from './game/GameTable';
import { TRICK_PAUSE_MS, TrickPauseContext } from './game/trickPause';
import { uk } from './i18n';
import { Lobby } from './lobby/Lobby';
import { UnfinishedGames } from './lobby/UnfinishedGames';
import { WaitingRoom } from './lobby/WaitingRoom';
import { type PokerClient, inviteCodeFromPath, replacePath } from './net/client';
import { ClientProvider, useClientState } from './net/react';
import { CardFace } from './ui/Card';
import { ConnectionBanner, ConnectionIndicator } from './ui/ConnectionStatus';
import { SettingsMenu } from './ui/SettingsMenu';
import { ThemeProvider } from './ui/theme';
import { AppUpdates } from './update';
import { VoiceChat, browserVoiceEnv } from './voice/VoiceChat';
import { VoiceProvider } from './voice/VoiceControls';

/** Каркас застосунку: шапка й основна область. */
export function App({
  client,
  trickPauseMs = TRICK_PAUSE_MS,
  updates: givenUpdates,
}: {
  client: PokerClient;
  /** Скільки завершена взятка лежить на столі, мс. */
  trickPauseMs?: number;
  /** Оновлення застосунку (service worker); без нього «Оновити» просто перезавантажує сторінку. */
  updates?: AppUpdates;
}) {
  const [fallbackUpdates] = useState(() => new AppUpdates());
  const updates = givenUpdates ?? fallbackUpdates;
  // Голосовий чат кімнати (T63) — лише в браузерах із WebRTC.
  const [voice] = useState(() =>
    typeof globalThis.RTCPeerConnection === 'function'
      ? new VoiceChat(client, browserVoiceEnv())
      : null,
  );
  useEffect(() => {
    voice?.start();
    return () => voice?.stop();
  }, [voice]);

  return (
    <ThemeProvider>
      <TrickPauseContext value={trickPauseMs}>
        <ClientProvider client={client}>
          <VoiceProvider voice={voice}>
            <div className="app">
              <header className="app__header">
                <h1 className="app__title">{uk.appTitle}</h1>
                <div className="app__tools">
                  <ConnectionIndicator />
                  <SettingsMenu />
                </div>
              </header>
              <ConnectionBanner updates={updates} />
              <main className="app__main">
                <Screen client={client} />
              </main>
            </div>
          </VoiceProvider>
        </ClientProvider>
      </TrickPauseContext>
    </ThemeProvider>
  );
}

/** Екран за станом: лобі, кімната очікування або гра. */
function Screen({ client }: { client: PokerClient }) {
  const { status, room, view } = useClientState();
  const [inviteCode, setInviteCode] = useState(() => inviteCodeFromPath(window.location.pathname));
  // Гравець уже в кімнаті: запрошення використане, після виходу — звичайна головна.
  if (room !== null && inviteCode !== null) setInviteCode(null);

  // Повертаємося в кімнату за збереженим токеном; запрошення в іншу кімнату його не використовує.
  useEffect(() => {
    void client.resume(inviteCodeFromPath(window.location.pathname) ?? undefined);
  }, [client]);

  // Адреса сторінки — посилання на поточну кімнату: його можна скопіювати або оновити сторінку.
  const code = room?.code ?? null;
  useEffect(() => {
    if (code !== null) replacePath(`/r/${code}`);
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
      <UnfinishedGames />
      <Lobby
        inviteCode={inviteCode}
        onForgetInvite={() => {
          replacePath('/');
          setInviteCode(null);
        }}
      />
    </div>
  );
}
