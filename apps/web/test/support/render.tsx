import type { GameState } from '@poker/engine';
import type { RoomState, WirePlayerView } from '@poker/protocol';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameTable } from '../../src/game/GameTable';
import { PokerClient } from '../../src/net/client';
import { ClientProvider } from '../../src/net/react';
import { FakeConnection } from './fakeConnection';
import { gameRoom, wireView } from './views';

/** Рендерить ігровий стіл із фейковим зʼєднанням. */
export function renderTable(room: RoomState, view: WirePlayerView) {
  const connection = new FakeConnection();
  const client = new PokerClient(connection);
  const user = userEvent.setup();
  const result = render(
    <ClientProvider client={client}>
      <GameTable room={room} view={view} />
    </ClientProvider>,
  );
  return { connection, user, ...result };
}

/** Рендерить стіл очима гравця на місці `seat`. */
export function renderAt(state: GameState, seat: number) {
  return renderTable(gameRoom(state.playerCount, seat), wireView(state, seat));
}

/** Значення, яке точно є (замість `!`). */
export function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Очікували значення');
  return value;
}
