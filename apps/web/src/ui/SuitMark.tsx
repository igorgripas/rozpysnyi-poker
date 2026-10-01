import type { JokerCall, Suit } from '@poker/engine';
import { suitSymbol, uk } from '../i18n';

const RED_SUITS: ReadonlySet<Suit> = new Set(['diamonds', 'hearts']);

/** ♦ і ♥ — червоні масті. */
export function isRedSuit(suit: Suit): boolean {
  return RED_SUITS.has(suit);
}

/** Символ масті в текстовому представленні (U+FE0E): ♥ ♦ не стають кольоровими емодзі. */
export function suitGlyph(suit: Suit): string {
  return `${suitSymbol(suit)}︎`;
}

/**
 * Значок масті поза картою: ♦ ♥ — червоні, ♠ ♣ — кольору тексту.
 * Розмір — як у навколишнього тексту, ніколи не зменшений окремо.
 */
export function SuitMark({ suit }: { suit: Suit }) {
  return (
    <span className="suit-mark" data-suit={suit} data-color={isRedSuit(suit) ? 'red' : 'black'}>
      {suitGlyph(suit)}
    </span>
  );
}

/** Оголошення джокера у взятці (§6): «беру», «старша ♠» тощо. */
export function JokerCallLabel({ call }: { call: JokerCall }) {
  switch (call.type) {
    case 'highTrump':
      return uk.jokerCall.highTrump;
    case 'high':
    case 'low':
      return (
        <>
          {call.type === 'high' ? uk.jokerCall.high : uk.jokerCall.low}{' '}
          <SuitMark suit={call.suit} />
        </>
      );
    case 'take':
      return uk.jokerCall.take;
    case 'discard':
      return uk.jokerCall.discard;
  }
}
