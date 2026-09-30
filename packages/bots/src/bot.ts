import type { Action, PlayerView } from '@poker/engine';

/** Бот бачить лише погляд свого гравця (`viewFor`) і повертає легальну дію. */
export interface Bot {
  readonly name: string;
  act(view: PlayerView): Action;
}

/** Перевіряє, що зараз хід гравця, для якого побудовано погляд. */
export function assertTurn(view: PlayerView): void {
  if (view.turn !== view.seat || view.legalActions.length === 0) {
    throw new Error(`Зараз не хід гравця ${view.seat}`);
  }
}
