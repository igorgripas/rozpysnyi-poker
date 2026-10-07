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

describe('евристичний бот: опції кімнати (§10)', () => {
  it('R-10.2: у «Темній» замовляє наосліп — за середньою часткою взяток', () => {
    const seen = scenario({
      phase: 'dark',
      trump: 'spades',
      hand: 'S14 S13 S12 S11 S10 S9 S8 S7 S6',
    });
    const view = { ...seen, blind: true, hand: [] };
    const action = bot.act(view);
    expect(view.legalActions).toContainEqual(action);
    // 9 карт на 4 гравців: у середньому 2,25 взятки — не пас і не «всі».
    expect(action.type === 'bid' && action.bid).toBeGreaterThanOrEqual(1);
    expect(action.type === 'bid' && action.bid).toBeLessThanOrEqual(3);
  });

  it('R-10.3: коли 0 заборонений, замовляє інше легальне значення', () => {
    const view = scenario({ trump: 'spades', hand: 'H6 H7 D6 D8 C6 C9' });
    const legalActions = view.legalActions.filter((a) => a.type === 'bid' && a.bid !== 0);
    const action = bot.act({ ...view, zeroForbidden: true, legalActions });
    expect(action).toEqual({ type: 'bid', seat: 0, bid: 1 });
  });

  it('R-10.1–R-10.3: боти грають повну гру з увімкненими опціями', () => {
    for (let players = MIN_PLAYERS; players <= MAX_PLAYERS; players++) {
      const bots = Array.from({ length: players }, () => createHeuristicBot());
      const state = playGame(players, bots, { dark: true, zeroLimit: true });
      expect(state.status).toBe('finished');
      expect(state.options).toEqual({ dark: true, zeroLimit: true });
      expect(state.history.some((record) => record.spec.phase === 'dark')).toBe(true);
    }
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

describe('евристичний бот: памʼять зіграних карт', () => {
  it('R-5.4: коли старші карти масті вже зіграно, заходить на взяття дамою, а не джокером', () => {
    const view = scenario({
      trump: null,
      hand: 'H12 J0 D7',
      bids: [1, 0, 0, 0],
      earlier: [
        { leader: 1, cards: 'H14 H13 C6 C7' },
        { leader: 1, cards: 'D14 D6 D8 J1' },
      ],
    });
    expect(playOf(bot.act(view)).card).toEqual(card('H12'));
  });

  it('R-5.2: хто не поклав масть заходу, її не має — дама бере, хоч старші карти невідомі', () => {
    const view = scenario({
      trump: null,
      hand: 'H12 J0 D7',
      bids: [1, 0, 0, 0],
      earlier: [
        { leader: 0, cards: 'H6 C6 D6 S6' },
        { leader: 0, cards: 'H7 C7 D8 S7' },
      ],
    });
    expect(playOf(bot.act(view)).card).toEqual(card('H12'));
  });

  it('R-5.2: знає, що суперник без масті заходу має козир, і не заходить тузом під ріжу', () => {
    const view = scenario({
      trump: 'spades',
      hand: 'H14 C14 D7',
      bids: [0, 0, 1, 0],
      seat: 2,
      dealt: 5,
      earlier: [
        { leader: 2, cards: 'H6 S7 H8 H9' },
        { leader: 3, cards: 'D6 C9 S8 D8' },
      ],
    });
    // Сусід ліворуч (місце 3) без чирви й із козирем: чирвового туза він переб'є.
    expect(playOf(bot.act(view)).card).toEqual(card('C14'));
  });
});

describe('евристичний бот: джокер', () => {
  it('R-6.1: заходить найстаршим козирем раніше за туза іншої масті, поки джокер «старший козир» не витяг його', () => {
    // Суперники не мають козирів (R-5.2), тож обидва тузи беруть; але козирного туза
    // суперник із джокером «старший козир» змусить покласти під джокер (R-6.1).
    const view = scenario({
      trump: 'spades',
      hand: 'H14 S14 D6',
      bids: [2, 0, 0, 0],
      earlier: [{ leader: 0, cards: 'S7 H6 C6 D7' }],
      taken: [1, 0, 0, 0],
    });
    expect(playOf(bot.act(view)).card).toEqual(card('S14'));
  });

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
      // Треба ще дві взятки, а певна лише одна — джокер: брати зараз.
      bids: [2, 0, 0, 0],
      trick: [played('H13'), played('H10'), played('H6')],
    });
    const action = playOf(bot.act(view));
    expect(action.card).toEqual(card('J0'));
    expect(action.call).toEqual({ type: 'take' });
  });

  it('R-6.4, R-7.3: коли певних взяток досить, не бере джокером, а скидає ризиковану старшу карту', () => {
    // Треба одна взятка, і джокер її принесе пізніше; король треф може взяти зайву — геть його.
    const view = scenario({
      trump: 'spades',
      hand: 'J0 C13 C6 H7',
      bids: [1, 0, 0, 0],
      trick: [played('D14'), played('D10'), played('D6')],
    });
    expect(playOf(bot.act(view)).card).toEqual(card('C13'));
  });

  it('R-5.4, R-7.3: коли певних взяток не вистачає, скидає найслабшу карту', () => {
    const view = scenario({
      trump: 'spades',
      hand: 'S7 C13 C6 H7',
      bids: [1, 0, 0, 0],
      trick: [played('S14'), played('S10'), played('S6')],
    });
    expect(playOf(bot.act(view)).card).toEqual(card('S7'));
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
      // Треба всі три взятки — без джокера не обійтися.
      bids: [3, 0, 0, 0],
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

describe('евристичний бот: мізер і відіграш з козирем', () => {
  it('R-3.1, R-7.5: у мізері без масті заходу кладе найстаршого козиря, що не бере', () => {
    const view = scenario({
      phase: 'misere',
      trump: 'spades',
      hand: 'S14 S9 S6 D7',
      trick: [played('H12'), played('S10')],
    });
    expect(playOf(bot.act(view)).card).toEqual(card('S9'));
  });

  it('R-3.1, R-7.5: у мізері останнім, коли козирем однаково брати, позбувається найстаршого', () => {
    const view = scenario({
      phase: 'misere',
      trump: 'spades',
      hand: 'S14 S7 D6',
      trick: [played('H9'), played('H10'), played('H12')],
    });
    expect(playOf(bot.act(view)).card).toEqual(card('S14'));
  });

  it('R-3.1, R-7.5: у мізері заходить найменшим козирем, поки старші козирі в суперників', () => {
    const view = scenario({ phase: 'misere', trump: 'spades', hand: 'S9 S13 H6 D7 C8' });
    expect(playOf(bot.act(view)).card).toEqual(card('S9'));
  });

  it('R-3.1, R-5.2, R-7.5: у мізері не заходить козирем, коли старших козирів у суперників немає', () => {
    // Усі старші пікові карти вже вийшли — козир узяв би взятку.
    const view = scenario({
      phase: 'misere',
      trump: 'spades',
      hand: 'S9 H6 D7',
      earlier: [
        { leader: 1, cards: 'S10 S11 S12 S6' },
        { leader: 1, cards: 'S13 S14 S7 S8' },
      ],
    });
    expect(playOf(bot.act(view)).card).not.toEqual(card('S9'));
  });

  it('R-3.1, R-5.2, R-7.5: у мізері не заходить козирем, коли в суперників козирів не лишилося', () => {
    // Усі троє суперників не поклали козир на козирний захід — козирів у них немає.
    const view = scenario({
      phase: 'misere',
      trump: 'spades',
      hand: 'S7 H6 D7',
      earlier: [{ leader: 0, cards: 'S6 H14 D14 C14' }],
    });
    expect(playOf(bot.act(view)).card).not.toEqual(card('S7'));
  });

  it('R-3.1, R-7.6: у відіграші перебиває масть найменшим козирем', () => {
    const view = scenario({
      phase: 'comeback',
      trump: 'spades',
      hand: 'S7 S12 D6',
      trick: [played('H9'), played('H10'), played('H14')],
    });
    expect(playOf(bot.act(view)).card).toEqual(card('S7'));
  });

  it('R-3.1, R-6.1, R-7.6: у відіграші з козирем заходить джокером «старший козир»', () => {
    const view = scenario({ phase: 'comeback', trump: 'spades', hand: 'J0 D7 C9 H8' });
    expect(playOf(bot.act(view))).toMatchObject({ card: card('J0'), call: { type: 'highTrump' } });
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
