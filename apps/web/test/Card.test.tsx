import { createDeck } from '@poker/engine';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CardBack, CardFace } from '../src/ui/Card';

describe('SVG-карти', () => {
  it('R-1.1: карта — SVG із рангом, мастю й доступною назвою', () => {
    render(<CardFace card={{ kind: 'standard', suit: 'hearts', rank: 12 }} />);
    const card = screen.getByRole('img', { name: 'Дама чирви' });
    expect(card.tagName.toLowerCase()).toBe('svg');
    expect(card).toHaveTextContent('Д');
    expect(card).toHaveTextContent('♥');
  });

  it('R-1.1: червоні масті (♦, ♥) відрізняються кольором від чорних (♠, ♣)', () => {
    render(
      <>
        <CardFace card={{ kind: 'standard', suit: 'diamonds', rank: 6 }} />
        <CardFace card={{ kind: 'standard', suit: 'clubs', rank: 6 }} />
      </>,
    );
    expect(screen.getByRole('img', { name: 'Шістка бубни' })).toHaveAttribute('data-color', 'red');
    expect(screen.getByRole('img', { name: 'Шістка трефи' })).toHaveAttribute(
      'data-color',
      'black',
    );
  });

  it('R-1.1: джокер має власне зображення', () => {
    render(<CardFace card={{ kind: 'joker', index: 1 }} />);
    expect(screen.getByRole('img', { name: 'Джокер' })).toHaveAttribute('data-color', 'joker');
  });

  it('R-1.1: усі 38 карт колоди малюються', () => {
    render(
      <>
        {createDeck().map((card, i) => (
          <CardFace key={i} card={card} />
        ))}
      </>,
    );
    expect(screen.getAllByRole('img')).toHaveLength(38);
  });

  it('сорочка карти не розкриває карту', () => {
    render(<CardBack />);
    expect(screen.getByRole('img', { name: 'Сорочка карти' })).toBeInTheDocument();
  });
});
