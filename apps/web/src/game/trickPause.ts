import { cardId } from '@poker/engine';
import type { WirePlayerView } from '@poker/protocol';
import { createContext, use, useEffect, useReducer } from 'react';
import { useMediaQuery } from '../ui/useMediaQuery';

/** Скільки завершена взятка лежить на столі, перш ніж її заберуть, мс. */
export const TRICK_PAUSE_MS = 2000;

/** Тривалість анімації «карти їдуть до переможця», мс. */
export const COLLECT_MS = 400;

/** Пауза взятки; тести й e2e можуть її скоротити. */
export const TrickPauseContext = createContext(TRICK_PAUSE_MS);

/** Пауза взятки з параметра `?trickPause=` (лише в режимі розробки, для e2e) або стандартна. */
export function trickPauseFromSearch(search: string, dev: boolean): number {
  const value = dev ? new URLSearchParams(search).get('trickPause') : null;
  const ms = value === null || value === '' ? Number.NaN : Number(value);
  return Number.isFinite(ms) && ms >= 0 ? ms : TRICK_PAUSE_MS;
}

export type CompletedTrick = NonNullable<WirePlayerView['lastTrick']>;

export interface TrickPause {
  /** Щойно завершена взятка. */
  readonly trick: CompletedTrick;
  /** Погляд, показаний до завершення взятки. */
  readonly before: WirePlayerView;
  /** `show` — взятка лежить на столі; `collect` — карти їдуть до переможця. */
  readonly phase: 'show' | 'collect';
}

interface State {
  /** Погляд, який зараз показано. */
  readonly shown: WirePlayerView;
  readonly pause: TrickPause | null;
  /** Погляди, що прийшли під час паузи: їх покажемо по черзі, нічого не губиться. */
  readonly queue: readonly WirePlayerView[];
}

type Event = { type: 'receive'; view: WirePlayerView } | { type: 'collect' } | { type: 'done' };

function trickKey(trick: CompletedTrick | null): string | null {
  return trick === null ? null : `${trick.winner}:${trick.cards.map(cardId).join(',')}`;
}

/** Показує погляди з черги, доки якийсь не завершить взятку — тоді пауза. */
function advance(state: State): State {
  let { shown, pause, queue } = state;
  while (pause === null && queue.length > 0) {
    const [next, ...rest] = queue as [WirePlayerView, ...WirePlayerView[]];
    queue = rest;
    if (next.lastTrick !== null && trickKey(next.lastTrick) !== trickKey(shown.lastTrick)) {
      pause = { trick: next.lastTrick, before: shown, phase: 'show' };
    }
    shown = next;
  }
  return { shown, pause, queue };
}

function reducer(state: State, event: Event): State {
  switch (event.type) {
    case 'receive':
      if (event.view === state.shown || state.queue.includes(event.view)) return state;
      return advance({ ...state, queue: [...state.queue, event.view] });
    case 'collect':
      return state.pause === null
        ? state
        : { ...state, pause: { ...state.pause, phase: 'collect' } };
    case 'done':
      return advance({ ...state, pause: null });
  }
}

export interface TrickPauseState {
  readonly shown: WirePlayerView;
  readonly pause: TrickPause | null;
  /** Є новіші погляди в черзі: показане вже застаріло, ходити з нього не можна. */
  readonly stale: boolean;
}

/**
 * Черга поглядів гравця: завершена взятка лишається на столі паузу взятки,
 * потім карти їдуть до переможця, і лише тоді показується наступний стан.
 */
export function useTrickPause(view: WirePlayerView): TrickPauseState {
  const pauseMs = use(TrickPauseContext);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const collectMs = reducedMotion ? 0 : COLLECT_MS;
  const [state, dispatch] = useReducer(reducer, { shown: view, pause: null, queue: [] });

  useEffect(() => dispatch({ type: 'receive', view }), [view]);

  const { pause } = state;
  useEffect(() => {
    if (pause === null) return;
    const timer = setTimeout(
      () => dispatch({ type: pause.phase === 'show' ? 'collect' : 'done' }),
      pause.phase === 'show' ? pauseMs : collectMs,
    );
    return () => clearTimeout(timer);
  }, [pause, pauseMs, collectMs]);

  return { shown: state.shown, pause, stale: state.queue.length > 0 };
}
