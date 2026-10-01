import { type Card, cardId } from '@poker/engine';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Hand } from '../src/game/Hand';

const joker: Card = { kind: 'joker', index: 1 };
const ace: Card = { kind: 'standard', suit: 'spades', rank: 14 };
const seven: Card = { kind: 'standard', suit: 'clubs', rank: 7 };
const all = (cards: readonly Card[]) => new Set(cards.map(cardId));
const pressed = () =>
  screen.queryAllByRole('button', { pressed: true }).map((b) => b.getAttribute('data-card'));

describe('Hand: вибір карти належить поточному ходу', () => {
  it('тап вибирає, другий тап по тій самій карті грає', async () => {
    const user = userEvent.setup();
    const onPlay = vi.fn();
    render(<Hand cards={[ace, seven]} legal={all([ace, seven])} onPlay={onPlay} />);
    await user.click(screen.getByRole('button', { name: /туз піки/i }));
    expect(onPlay).not.toHaveBeenCalled();
    expect(pressed()).toEqual([cardId(ace)]);
    await user.click(screen.getByRole('button', { name: /туз піки/i }));
    expect(onPlay).toHaveBeenCalledWith(ace);
  });

  it('вибраний джокер не переходить у наступний хід, навіть якщо він знову легальний', async () => {
    const user = userEvent.setup();
    const onPlay = vi.fn();
    const cards = [joker, ace, seven];
    const { rerender } = render(<Hand cards={cards} legal={all(cards)} onPlay={onPlay} />);
    await user.click(screen.getByRole('button', { name: /джокер/i }));
    expect(pressed()).toEqual([cardId(joker)]);

    // Хід перейшов до іншого гравця, потім повернувся з тими самими легальними картами.
    rerender(<Hand cards={cards} legal={null} onPlay={onPlay} />);
    rerender(<Hand cards={cards} legal={all(cards)} onPlay={onPlay} />);
    expect(pressed()).toEqual([]);

    await user.click(screen.getByRole('button', { name: /джокер/i }));
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('вибір скидається, коли змінилась рука або прийшов resetKey', async () => {
    const user = userEvent.setup();
    const onPlay = vi.fn();
    const cards = [joker, ace, seven];
    const { rerender } = render(
      <Hand cards={cards} legal={all(cards)} onPlay={onPlay} resetKey={0} />,
    );
    await user.click(screen.getByRole('button', { name: /джокер/i }));
    rerender(<Hand cards={cards} legal={all(cards)} onPlay={onPlay} resetKey={1} />);
    expect(pressed()).toEqual([]);

    await user.click(screen.getByRole('button', { name: /туз піки/i }));
    const fewer = [joker, ace];
    rerender(<Hand cards={fewer} legal={all(fewer)} onPlay={onPlay} resetKey={1} />);
    expect(pressed()).toEqual([]);
  });
});
