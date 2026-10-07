import { createGame } from '@poker/engine';
import type { WirePlayerView } from '@poker/protocol';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Results } from '../src/game/Results';
import { PLAYER_NAMES, advanceUntil, wireView } from './support/views';

function finishedView(options = { dark: false, zeroLimit: false }): WirePlayerView {
  const state = advanceUntil(createGame(1, 3, options), (s) => s.status === 'finished');
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

describe('фінальний екран: опції гри', () => {
  it('R-10.1: ввімкнені опції видно й на екрані результатів', () => {
    const results = renderResults(finishedView({ dark: true, zeroLimit: true }));
    const options = within(results).getByRole('list', { name: 'Опції гри' });
    expect(
      within(options)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Темна', 'Не більше трьох нулів поспіль']);
  });

  it('R-10.2: підсумок гри з «Темною» пояснено — опцію видно в результатах', () => {
    const results = renderResults(finishedView({ dark: true, zeroLimit: false }));
    const options = within(results).getByRole('list', { name: 'Опції гри' });
    expect(
      within(options)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Темна']);
  });

  it('R-10.1: без опцій результати кажуть, що гра йшла за основними правилами', () => {
    const results = renderResults(finishedView());
    expect(within(results).queryByRole('list', { name: 'Опції гри' })).not.toBeInTheDocument();
    expect(results).toHaveTextContent('Опції гри: немає');
  });
});
