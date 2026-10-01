import { describe, expect, it } from 'vitest';
import { type Action, MAX_PLAYERS, MIN_PLAYERS, gameLog, replay } from '@poker/engine';
import { createHeuristicBot, createRandomBot, playGame } from '../src/index.js';
import { card, played, scenario } from './support/view.js';

const bot = createHeuristicBot();

function playOf(action: Action) {
  if (action.type !== 'play') throw new Error(`Очікувався хід картою, а не ${action.type}`);
  return action;
}

describe('евристичний бот: замовлення', () => {
  it('R-4.3: сильна рука замовляє кілька взяток', () => {
    const view = scenario({ trump: 'spades', hand: 'S14 S13 H14 J0 D6 C7' });
    const action = bot.act(view);
    expect(action.type).toBe('bid');
    expect(action.type === 'bid' && action.bid).toBeGreaterThanOrEqual(3);
  });

  it('R-7.2: слабка рука без козирів пасує', () => {
    const view = scenario({ trump: 'spades', hand: 'H6 H7 D6 D8 C6 C9' });
    expect(bot.act(view)).toEqual({ type: 'bid', seat: 0, bid: 0 });
  });

  it('R-4.4: роздаючий не замовляє заборонене значення, навіть якщо рука його просить', () => {
    // Інші замовили 6 з 6 → роздаючому заборонено 0, хоча рука слабка.
    const view = scenario({
      seat: 3,
      dealer: 3,
      trump: 'spades',
      hand: 'H6 H7 D6 D8 C6 C9',
      bids: [2, 2, 2, null],
    });
    const action = bot.act(view);
    expect(view.legalActions).toContainEqual(action);
    expect(action).toEqual({ type: 'bid', seat: 3, bid: 1 });
  });

  it('R-4.6: у роздачі з 1–3 картами роздаючий може замовити значення, що дає суму = K', () => {
    // Інші замовили 3 з 3 → у роздачі на 3 карти роздаючий не обмежений і пасує зі слабкою рукою.
    const view = scenario({
      seat: 3,
      dealer: 3,
      phase: 'ascending',
      trump: 'spades',
      hand: 'H6 D6 C6',
      bids: [1, 1, 1, null],
    });
    expect(view.legalActions).toHaveLength(4);
    expect(bot.act(view)).toEqual({ type: 'bid', seat: 3, bid: 0 });
  });
});

describe('евристичний бот: розіграш на замовлення', () => {
  it('R-5.4: коли треба брати і ходить останнім, бере найменшою картою, що перебиває', () => {
    const view = scenario({
      trump: 'spades',
      hand: 'H14 H12 H7',
      bids: [1, 0, 0, 0],
      trick: [played('H9'), played('H10'), played('H6')],
    });
    expect(playOf(bot.act(view)).card).toEqual(card('H12'));
  });

  it('R-5.4: коли замовлення виконане, скидає найстаршу карту, яка не бере', () => {
    const view = scenario({
      trump: 'spades',
      hand: 'H14 H12 H7',
      bids: [0, 1, 0, 0],
      trick: [played('H13'), played('H10'), played('H6')],
    });
    expect(playOf(bot.act(view)).card).toEqual(card('H12'));
  });

  it('R-5.4: коли треба брати, заходить найсильнішою картою', () => {
    const view = scenario({ trump: 'spades', hand: 'S14 H7 D8', bids: [1, 0, 0, 0] });
    expect(playOf(bot.act(view)).card).toEqual(card('S14'));
  });

  it('R-5.4: коли брати не треба, заходить найслабшою картою', () => {
    const view = scenario({ trump: 'spades', hand: 'S14 H7 D8', bids: [0, 1, 0, 0] });
    expect(playOf(bot.act(view)).card).toEqual(card('H7'));
  });
});

describe('евристичний бот: джокер', () => {
  it('R-6.1: заходить джокером «старший козир», коли треба взяти, а сильних карт немає', () => {
    const view = scenario({ trump: 'spades', hand: 'J0 H7 D8', bids: [1, 0, 0, 0] });
    const action = playOf(bot.act(view));
    expect(action.card).toEqual(card('J0'));
    expect(action.call).toEqual({ type: 'highTrump' });
  });

  it('R-6.2: без козиря заходить джокером «старша <масть>», коли треба взяти', () => {
    const view = scenario({ trump: null, hand: 'J0 H7 D8', bids: [1, 0, 0, 0] });
    const action = playOf(bot.act(view));
    expect(action.card).toEqual(card('J0'));
    expect(action.call?.type).toBe('high');
  });

  it('R-6.3: заходить єдиним джокером як «маленька», коли брати не треба', () => {
    const view = scenario({ trump: 'spades', hand: 'J0', bids: [0, 0, 0, 0] });
    const action = playOf(bot.act(view));
    expect(action.card).toEqual(card('J0'));
    expect(action.call?.type).toBe('low');
  });

  it("R-6.4: б'є джокером «беру», коли треба взяти, а звичайні карти не перебивають", () => {
    const view = scenario({
      trump: 'spades',
      hand: 'J0 H7 D8',
      bids: [1, 0, 0, 0],
      trick: [played('H13'), played('H10'), played('H6')],
    });
    const action = playOf(bot.act(view));
    expect(action.card).toEqual(card('J0'));
    expect(action.call).toEqual({ type: 'take' });
  });

  it('R-6.4: не витрачає джокера, якщо взятку бере звичайна карта', () => {
    const view = scenario({
      trump: 'spades',
      hand: 'J0 H14 D8',
      bids: [1, 0, 0, 0],
      trick: [played('H13'), played('H10'), played('H6')],
    });
    expect(playOf(bot.act(view)).card).toEqual(card('H14'));
  });

  it('R-6.5: скидає джокера, коли брати не треба, а кожна звичайна карта взяла б', () => {
    const view = scenario({
      trump: 'spades',
      hand: 'J0 H14 H13',
      bids: [0, 1, 0, 0],
      trick: [played('H9'), played('H10'), played('H6')],
    });
    const action = playOf(bot.act(view));
    expect(action.card).toEqual(card('J0'));
    expect(action.call).toEqual({ type: 'discard' });
  });

  it('R-6.6: відповідає джокером «беру» на захід джокером «старший козир», коли треба взяти', () => {
    const view = scenario({
      trump: 'spades',
      hand: 'J1 H14 D8',
      bids: [1, 0, 0, 0],
      trick: [{ kind: 'joker', index: 0, call: { type: 'highTrump' } }],
    });
    const action = playOf(bot.act(view));
    expect(action.card).toEqual(card('J1'));
    expect(action.call).toEqual({ type: 'take' });
  });
});

describe('евристичний бот: мізер і відіграш', () => {
  it('R-7.5: у мізері скидає найстаршу карту, яка не бере', () => {
    const view = scenario({
      phase: 'misere',
      trump: null,
      hand: 'H14 H11 H7 D6',
      trick: [played('H12')],
    });
    expect(playOf(bot.act(view)).card).toEqual(card('H11'));
  });

  it('R-7.5: у мізері заходить найменшою картою', () => {
    const view = scenario({ phase: 'misere', trump: null, hand: 'H14 H11 D6 C13' });
    expect(playOf(bot.act(view)).card).toEqual(card('D6'));
  });

  it('R-7.5: у мізері скидає джокера, якщо інакше довелося б узяти', () => {
    const view = scenario({
      phase: 'misere',
      trump: null,
      hand: 'H14 J0',
      trick: [played('H12')],
    });
    expect(playOf(bot.act(view))).toMatchObject({ card: card('J0'), call: { type: 'discard' } });
  });

  it('R-7.6: у відіграші бере взятку найменшою картою, що перебиває', () => {
    const view = scenario({
      phase: 'comeback',
      trump: null,
      hand: 'H14 H13 H7',
      trick: [played('H9'), played('H10'), played('H12')],
    });
    expect(playOf(bot.act(view)).card).toEqual(card('H13'));
  });

  it('R-7.6: у відіграші заходить найсильнішою картою', () => {
    const view = scenario({ phase: 'comeback', trump: null, hand: 'H14 D7 C9' });
    expect(playOf(bot.act(view)).card).toEqual(card('H14'));
  });
});

describe('евристичний бот: повні ігри', () => {
  it.each(Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i))(
    'R-2.1: грає лише легальні дії до кінця гри на %i гравців, лог відтворюється (R-2.3)',
    (playerCount) => {
      const bots = Array.from({ length: playerCount }, (_, seat) =>
        seat % 2 === 0 ? createHeuristicBot() : createRandomBot(seat),
      );
      const state = playGame(21, bots);
      expect(state.status).toBe('finished');
      expect(replay(21, gameLog(state))).toEqual(state);
    },
  );

  it('детермінований: однакові погляди дають однакові дії', () => {
    const view = scenario({ trump: 'spades', hand: 'S14 S13 H14 J0 D6 C7' });
    expect(createHeuristicBot().act(view)).toEqual(createHeuristicBot().act(view));
  });
});
