import { createGame } from '@poker/engine';
import type { WirePlayerView } from '@poker/protocol';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Results } from '../src/game/Results';
import { PLAYER_NAMES, advanceUntil, wireView } from './support/views';

function finishedView(): WirePlayerView {
  const state = advanceUntil(createGame(1, 3), (s) => s.status === 'finished');
  return wireView(state, 0);
}

/** Той самий фінал, але з заданими підсумками гравців. */
function withFinals(view: WirePlayerView, finals: readonly number[]): WirePlayerView {
  const summary = view.table.summary.map((s, seat) => ({ ...s, final: finals[seat] ?? 0 }));
  return { ...view, table: { ...view.table, summary } };
}

function renderResults(view: WirePlayerView) {
  render(
    <Results
      view={view}
      names={PLAYER_NAMES.slice(0, 3)}
      onReportBug={() => {}}
      onNewGame={() => {}}
    />,
  );
  return screen.getByRole('region', { name: 'Результати' });
}

describe('фінальний екран: привітання переможця', () => {
  it('R-9.4: вітаємо гравця з найбільшим фінальним підсумком', () => {
    renderResults(withFinals(finishedView(), [49, 127, -77]));
    const greeting = screen.getByRole('heading', { level: 3 });
    expect(greeting).toHaveTextContent('🏆 Вітаємо, Бот 1! Перемога з 127 очками');
    expect(greeting).toHaveClass('results__winner');
  });

  it('R-9.4: за рівних підсумків місце ділять — вітаємо всіх переможців', () => {
    renderResults(withFinals(finishedView(), [131, 40, 131]));
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(
      '🏆 Вітаємо, Оля і Бот 2! Спільна перемога з 131 очком',
    );
  });

  it('R-9.4: троє переможців і відʼємний підсумок', () => {
    renderResults(withFinals(finishedView(), [-12, -12, -12]));
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(
      '🏆 Вітаємо, Оля, Бот 1 і Бот 2! Спільна перемога з −12 очками',
    );
  });
});
