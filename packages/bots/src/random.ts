import { type Action, createRng } from '@poker/engine';
import { type Bot, assertTurn } from './bot.js';

/** Випадковий легальний бот: рівноймовірно обирає одну з легальних дій (seed RNG). */
export function createRandomBot(seed: number): Bot {
  const rng = createRng(seed);
  return {
    name: 'random',
    act(view) {
      assertTurn(view);
      return view.legalActions[rng.nextInt(view.legalActions.length)] as Action;
    },
  };
}
