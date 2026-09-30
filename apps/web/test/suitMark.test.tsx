import { SUITS, type Suit } from '@poker/engine';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SuitMark } from '../src/ui/SuitMark';

const RED: readonly Suit[] = ['diamonds', 'hearts'];

function markOf(suit: Suit) {
  const { container } = render(<SuitMark suit={suit} />);
  return container.querySelector('.suit-mark') as HTMLElement;
}

describe('значок масті', () => {
  it('R-1.1: ♦ і ♥ червоні, ♠ і ♣ — кольору тексту', () => {
    for (const suit of SUITS) {
      const mark = markOf(suit);
      expect(mark).toHaveAttribute('data-suit', suit);
      if (RED.includes(suit)) expect(mark).toHaveAttribute('data-color', 'red');
      else expect(mark).not.toHaveAttribute('data-color', 'red');
    }
  });

  it('символ масті — текстовий (U+FE0E), а не кольорове емодзі', () => {
    render(
      <>
        <SuitMark suit="spades" />
        <SuitMark suit="clubs" />
        <SuitMark suit="diamonds" />
        <SuitMark suit="hearts" />
      </>,
    );
    const texts = Array.from(document.querySelectorAll('.suit-mark'), (el) => el.textContent);
    expect(texts).toEqual(['♠︎', '♣︎', '♦︎', '♥︎']);
  });

  it('масть того ж розміру, що й текст поруч: без класів і стилів зменшення', () => {
    for (const suit of SUITS) {
      const mark = markOf(suit);
      expect(mark.className).toBe('suit-mark');
      expect(mark.getAttribute('style')).toBeNull();
      expect(mark.tagName.toLowerCase()).toBe('span');
      expect(mark.closest('sup, sub, small')).toBeNull();
    }
  });

  it('текст масті доступний скрінрідерам разом із навколишнім текстом', () => {
    render(
      <p>
        9<SuitMark suit="hearts" />
      </p>,
    );
    expect(screen.getByText(/^9/)).toHaveTextContent('9♥');
  });
});
