import { type GameState, apply, createGame, legalActions } from '@poker/engine';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { GameTable } from '../src/game/GameTable';
import { TrickPauseContext } from '../src/game/trickPause';
import { PokerClient } from '../src/net/client';
import { ClientProvider } from '../src/net/react';
import { SOUNDS, SOUND_STORAGE_KEY, type SoundName, resetSound } from '../src/ui/sound';
import { FakeConnection } from './support/fakeConnection';
import { advanceUntil, gameRoom, wireView } from './support/views';

/** Фейковий Web Audio: записує частоти всіх запущених осциляторів. */
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  readonly started: number[] = [];
  readonly currentTime = 0;
  readonly destination = {};
  state: AudioContextState = 'suspended';

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  resume() {
    this.state = 'running';
    return Promise.resolve();
  }

  createOscillator() {
    let frequency = 0;
    return {
      type: 'sine',
      frequency: { setValueAtTime: (value: number) => (frequency = value) },
      connect: () => {},
      start: () => this.started.push(frequency),
      stop: () => {},
    };
  }

  createGain() {
    const param = {
      setValueAtTime: () => {},
      linearRampToValueAtTime: () => {},
      exponentialRampToValueAtTime: () => {},
    };
    return { gain: param, connect: () => {} };
  }
}

/** Частоти, з яких складається звук. */
function tones(...names: SoundName[]): number[] {
  return names.flatMap((name) => SOUNDS[name].map((tone) => tone.frequency));
}

function played(): number[] {
  return FakeAudioContext.instances.flatMap((context) => context.started);
}

/** Стіл, якому можна підкладати нові стани гри. */
function renderGame(start: GameState, seat: number) {
  const room = gameRoom(start.playerCount, seat);
  const client = new PokerClient(new FakeConnection());
  const table = (state: GameState) => (
    <TrickPauseContext value={0}>
      <ClientProvider client={client}>
        <GameTable room={room} view={wireView(state, seat)} />
      </ClientProvider>
    </TrickPauseContext>
  );
  const { rerender } = render(table(start));
  return (state: GameState) => rerender(table(state));
}

/** Дія користувача, після якої браузер дозволяє звук. */
function userGesture() {
  fireEvent.pointerDown(document.body);
}

function step(state: GameState): GameState {
  const [action] = legalActions(state);
  if (action === undefined) throw new Error('Немає дій');
  return apply(state, action);
}

beforeEach(() => {
  FakeAudioContext.instances = [];
  vi.stubGlobal('AudioContext', FakeAudioContext);
});

afterEach(() => {
  resetSound();
  vi.unstubAllGlobals();
});

describe('звуки гри', () => {
  it('до першої дії користувача звук не стартує, після неї — грає на свій хід', () => {
    const start = createGame(1, 3);
    const seat = ((start.turn ?? 0) + 1) % 3;
    const show = renderGame(start, seat);
    show(advanceUntil(start, (s) => s.turn === seat));
    expect(FakeAudioContext.instances).toHaveLength(0);

    show(start);
    userGesture();
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0]?.state).toBe('running');
    show(advanceUntil(start, (s) => s.turn === seat));
    expect(played()).toEqual(tones('turn'));
  });

  it('зіграна карта, взятка й кінець роздачі мають свої звуки', () => {
    // Перша роздача — 1 карта: три карти, одна взятка, і роздача завершена.
    const start = advanceUntil(createGame(1, 3), (s) => s.status === 'playing');
    const first = step(start);
    const done = step(step(first));
    expect(done.hand.spec.index).toBe(1);
    // Гравець, у якого в ці моменти не його хід — щоб не було звуку «ваш хід».
    const seat = [0, 1, 2].find((s) => s !== first.turn && s !== done.turn) ?? 0;
    const show = renderGame(start, seat);
    userGesture();

    show(first);
    expect(played()).toEqual(tones('card'));

    show(done);
    expect(played()).toEqual(tones('card', 'card', 'trick', 'handEnd'));
  });

  it('вимкнений звук не грає', () => {
    localStorage.setItem(SOUND_STORAGE_KEY, 'off');
    const state = advanceUntil(createGame(1, 3), (s) => s.status === 'playing');
    const show = renderGame(state, 0);
    userGesture();
    show(step(state));
    expect(played()).toEqual([]);
  });

  it('перемикач звуку поруч із вібрацією вмикає й вимикає звук і запамʼятовує вибір', async () => {
    Object.defineProperty(navigator, 'vibrate', { value: () => true, configurable: true });
    render(<App client={new PokerClient(new FakeConnection())} />);
    const toggle = screen.getByRole('button', { name: 'Звуки гри' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // Поруч із перемикачем вібрації.
    expect(toggle.previousElementSibling).toHaveAccessibleName('Вібрація на свій хід');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem(SOUND_STORAGE_KEY)).toBe('off');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem(SOUND_STORAGE_KEY)).toBe('on');
    Reflect.deleteProperty(navigator, 'vibrate');
  });

  it('без Web Audio перемикача немає', () => {
    vi.stubGlobal('AudioContext', undefined);
    render(<App client={new PokerClient(new FakeConnection())} />);
    expect(screen.queryByRole('button', { name: 'Звуки гри' })).not.toBeInTheDocument();
  });
});
