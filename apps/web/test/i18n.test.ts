import { RANKS, SUITS, createDeck } from '@poker/engine';
import { describe, expect, it } from 'vitest';
import {
  cardName,
  phaseName,
  plural,
  rankLabel,
  suitName,
  suitSymbol,
  trumpLabel,
  uk,
} from '../src/i18n';

describe('українська локалізація', () => {
  it('R-1.1: ранги мають українські позначення 6…10, В, Д, К, Т', () => {
    expect(RANKS.map(rankLabel)).toEqual(['6', '7', '8', '9', '10', 'В', 'Д', 'К', 'Т']);
  });

  it('R-1.1: масті — ♠ піка, ♣ трефа, ♦ бубна, ♥ чирва', () => {
    expect(SUITS.map(suitSymbol)).toEqual(['♠', '♣', '♦', '♥']);
    expect(SUITS.map(suitName)).toEqual(['піка', 'трефа', 'бубна', 'чирва']);
  });

  it('R-1.1: кожна з 36 звичайних карт має власну назву, обидва джокери — «Джокер»', () => {
    const names = createDeck().map(cardName);
    expect(new Set(names).size).toBe(37);
    expect(names.filter((name) => name === 'Джокер')).toHaveLength(2);
    expect(cardName({ kind: 'standard', suit: 'hearts', rank: 14 })).toBe('Туз чирви');
    expect(cardName({ kind: 'standard', suit: 'spades', rank: 10 })).toBe('Десятка піки');
    expect(cardName({ kind: 'joker', index: 0 })).toBe('Джокер');
  });

  it('R-2.1: етапи гри мають українські назви', () => {
    expect(phaseName('ascending')).toBe('Зростання');
    expect(phaseName('maximum')).toBe('Максимум');
    expect(phaseName('suits')).toBe('Масті');
    expect(phaseName('noTrump')).toBe('Безкозирка');
    expect(phaseName('misere')).toBe('Мізер');
    expect(phaseName('comeback')).toBe('Відіграш');
  });

  it('R-3.2: роздача без козиря позначається «б/к»', () => {
    expect(trumpLabel(null)).toBe('б/к');
    expect(trumpLabel('diamonds')).toBe('♦ бубна');
  });

  it('узгоджує іменник із числівником за правилами української мови', () => {
    const tricks = (n: number) => `${n} ${plural(n, uk.plural.trick)}`;
    expect(tricks(1)).toBe('1 взятка');
    expect(tricks(3)).toBe('3 взятки');
    expect(tricks(5)).toBe('5 взяток');
    expect(tricks(11)).toBe('11 взяток');
    expect(tricks(21)).toBe('21 взятка');
    expect(tricks(0)).toBe('0 взяток');
  });
});
