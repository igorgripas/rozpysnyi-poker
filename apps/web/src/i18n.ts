import type { Card, HandPhase, JokerCall, Rank, Suit } from '@poker/engine';

/** Форми іменника для 1, 2–4 і 5+ (українська множина). */
export type PluralForms = readonly [one: string, few: string, many: string];

/** Усі тексти інтерфейсу українською. */
export const uk = {
  appTitle: 'Розписний покер',
  theme: {
    toLight: 'Світла тема',
    toDark: 'Темна тема',
  },
  vibration: {
    label: 'Вібрація на свій хід',
    on: 'Вібрація на свій хід: увімкнена',
    off: 'Вібрація на свій хід: вимкнена',
  },
  sound: {
    label: 'Звуки гри',
    on: 'Звуки гри: увімкнені',
    off: 'Звуки гри: вимкнені',
  },
  voice: {
    title: 'Голосовий чат',
    mic: 'Мікрофон',
    micOn: 'Мікрофон увімкнений: вас чують',
    micOff: 'Мікрофон вимкнений',
    muteOthers: 'Вимкнути звук інших',
    httpsOnly: 'Голосовий чат працює лише через HTTPS — відкрийте гру за адресою https://',
    denied: 'Немає доступу до мікрофона: дозвольте його в налаштуваннях браузера',
    speaking: 'говорить',
  },
  connection: {
    indicator: {
      connecting: 'Підключення до сервера…',
      online: 'Звʼязок є',
      offline: 'Немає звʼязку',
      waking: 'Сервер прокидається…',
      outdated: 'Потрібно оновити сторінку',
    },
    offline: 'Немає звʼязку з сервером.',
    reconnecting: 'Перепідключаємося…',
    waking: 'Сервер прокидається, зачекайте до хвилини…',
    outdated: 'Вийшла нова версія гри. Оновіть сторінку, щоб продовжити.',
    reload: 'Оновити',
  },
  home: {
    tagline: 'Карткова гра на 3–6 гравців. Грайте з друзями або з ботами.',
  },
  lobby: {
    name: 'Ваше імʼя',
    namePlaceholder: 'Як вас звати?',
    create: 'Створити кімнату',
    or: 'або',
    code: 'Код кімнати',
    codePlaceholder: 'Напр. K7QPD',
    join: 'Увійти',
    joinInvited: 'Увійти в кімнату',
    invited: (code: string) => `Вас запросили в кімнату ${code}`,
    otherRoom: 'Інша кімната',
    nameRequired: 'Введіть імʼя (до 20 символів)',
    badCode: 'Код кімнати — 5 символів (латинські літери й цифри)',
    resuming: 'Повертаємося в кімнату…',
  },
  room: {
    title: (code: string) => `Кімната ${code}`,
    inviteHint: 'Надішліть друзям посилання або код кімнати.',
    share: 'Поділитися',
    shareTitle: 'Розписний покер',
    shareText: (code: string) => `Приєднуйся до гри в розписний покер! Кімната ${code}`,
    copied: 'Посилання скопійовано',
    players: 'Гравці',
    host: 'хост',
    you: 'ви',
    bot: 'бот',
    offline: 'не в мережі',
    addBot: 'Додати бота',
    removeBot: (name: string) => `Прибрати ${name}`,
    shuffle: 'Перемішати місця',
    start: 'Почати гру',
    needPlayers: (min: number) => `Потрібно щонайменше ${min} гравці`,
    waitingHost: 'Чекаємо, поки хост почне гру',
  },
  card: {
    joker: 'Джокер',
    back: 'Сорочка карти',
  },
  noTrump: 'б/к',
  game: {
    dealing: 'Роздаємо карти…',
    hand: 'Роздача',
    handOf: (n: number, total: number) => `Роздача ${n} з ${total}`,
    trump: 'Козир:',
    revealed: 'Відкрита карта',
    noTrump: 'Без козиря',
    table: 'Стіл',
    trick: 'Взятка',
    lastTrick: (name: string) => `Остання взятка: ${name}`,
    takes: (name: string) => `Бере: ${name}`,
    youTake: 'Ви берете',
    lastTaker: 'взяв останню',
    handOver: 'Роздачу завершено',
    players: 'Гравці за столом',
    yourCards: 'Ваші карти',
    yourTurn: 'Ваш хід',
    yourBid: 'Ваш хід — замовлення',
    turnOf: (name: string) => `Хід: ${name}`,
    finished: 'Гру завершено',
    dealer: 'роздає',
    you: 'ви',
    bid: 'замовлення',
    noBid: 'ще не замовив',
    taken: (n: number) => `Взято: ${n}`,
    cardsLeft: (n: number) => `Карт: ${n}`,
    offline: 'не в мережі',
  },
  bidding: {
    title: 'Замовлення',
    yours: 'Ваше замовлення',
    sum: (sum: number, cards: number) => `Замовлено: ${sum} з ${cards}`,
    forbidden: (bid: number, cards: number) =>
      `Роздаючому не можна замовити ${bid}: сума замовлень не може дорівнювати кількості карт (${cards})`,
    queue: 'Черга замовлень',
    queueSum: (sum: number, cards: number) => `Сума: ${sum} з ${cards}`,
    dealerCannot: (bid: number) => `Роздаючому не можна: ${bid}`,
    made: (bid: number) => `замовив ${bid}`,
    turn: 'замовляє зараз',
    waiting: 'ще чекає',
  },
  jokerCall: {
    highTrump: 'старший козир',
    high: 'старша',
    low: 'маленька',
    take: 'беру',
    discard: 'скидаю',
  },
  jokerDialog: {
    title: 'Оголошення джокера',
    highTrump: 'Старший козир',
    take: 'Беру',
    discard: 'Скидаю',
    high: 'Старша',
    low: 'Маленька',
    highTrumpHint: 'Усі кладуть свій найстарший козир; бере джокер.',
    highHint: 'Усі кладуть найстаршу карту цієї масті; без неї — козир.',
    lowHint: 'Джокер — карта цієї масті, молодша за шістку.',
    takeHint: 'Джокер бʼє будь-яку карту.',
    discardHint: 'Джокер не бере взятку.',
    cancel: 'Скасувати',
  },
  bugReport: {
    open: 'Повідомити про баг',
    title: 'Повідомити про баг',
    label: 'Що сталося?',
    hint: 'Разом з описом надішлемо запис цієї гри, щоб баг можна було відтворити.',
    send: 'Надіслати',
    sending: 'Надсилаємо…',
    cancel: 'Скасувати',
    thanks: 'Дякуємо! Звіт надіслано.',
    pending: 'Дякуємо! Звіт буде надіслано після завершення гри.',
    link: 'Відкрити звіт',
    close: 'Закрити',
  },
  sheet: {
    title: 'Таблиця гри',
    open: 'Таблиця',
    close: 'Закрити',
    deal: 'Роздача',
    showAll: 'Показати взяті й підсумок',
    columns: { bid: 'замовлення', taken: 'взяв', points: 'бали', total: 'разом' },
    short: { bid: 'зам', taken: 'взяв', points: 'бал', total: 'Σ' },
    marks: { noTrump: 'Б', misere: 'М', comeback: 'В' },
    row: (n: number, phase: string, cards: string, trump: string, dealer: string) =>
      `Роздача ${n}: ${phase}, ${cards}, козир ${trump}, роздає ${dealer}`,
    result: { hit: 'влучив', miss: 'не влучив' },
    jokers: 'Джокери × −10',
    final: 'Рахунок',
    /** Легенда після зразка «9♥» (його малює значок масті). */
    legend:
      '— карт у роздачі й козир, б/к — без козиря · Б — безкозирка · М — мізер · В — відіграш · 3→2 — замовив→взяв, зафарбовано — влучив · ◯ — джокер (кружечок навколо замовлення) · ◤ — роздавав',
    results: 'Результати',
  },
  results: {
    /** «Вітаємо, Оля! Перемога з 127 очками»; за рівних підсумків — усі імена (R-9.4). */
    winner: (names: readonly string[], score: string, points: number) =>
      `Вітаємо, ${listNames(names)}! ${names.length > 1 ? 'Спільна перемога' : 'Перемога'} з ${score} ${plural(points, uk.plural.pointWith)}`,
  },
  plural: {
    trick: ['взятка', 'взятки', 'взяток'],
    card: ['карта', 'карти', 'карт'],
    player: ['гравець', 'гравці', 'гравців'],
    joker: ['джокер', 'джокери', 'джокерів'],
    /** Орудний відмінок: «з 1 очком», «з 5 очками». */
    pointWith: ['очком', 'очками', 'очками'],
  },
} as const satisfies Record<string, unknown>;

const RANK_LABELS: Record<Rank, string> = {
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'В',
  12: 'Д',
  13: 'К',
  14: 'Т',
};

const RANK_NAMES: Record<Rank, string> = {
  6: 'Шістка',
  7: 'Сімка',
  8: 'Вісімка',
  9: 'Девʼятка',
  10: 'Десятка',
  11: 'Валет',
  12: 'Дама',
  13: 'Король',
  14: 'Туз',
};

const SUIT_SYMBOLS: Record<Suit, string> = {
  spades: '♠',
  clubs: '♣',
  diamonds: '♦',
  hearts: '♥',
};

const SUIT_NAMES: Record<Suit, string> = {
  spades: 'піка',
  clubs: 'трефа',
  diamonds: 'бубна',
  hearts: 'чирва',
};

/** Родовий відмінок масті: «туз піки». */
const SUIT_GENITIVE: Record<Suit, string> = {
  spades: 'піки',
  clubs: 'трефи',
  diamonds: 'бубни',
  hearts: 'чирви',
};

const PHASE_NAMES: Record<HandPhase, string> = {
  ascending: 'Зростання',
  maximum: 'Максимум',
  suits: 'Масті',
  noTrump: 'Безкозирка',
  misere: 'Мізер',
  comeback: 'Відіграш',
};

/** Коротке позначення рангу (R-1.1): 6…10, В, Д, К, Т. */
export function rankLabel(rank: Rank): string {
  return RANK_LABELS[rank];
}

export function suitSymbol(suit: Suit): string {
  return SUIT_SYMBOLS[suit];
}

export function suitName(suit: Suit): string {
  return SUIT_NAMES[suit];
}

/** Повна назва карти для доступності: «Дама чирви», «Джокер». */
export function cardName(card: Card): string {
  if (card.kind === 'joker') return uk.card.joker;
  return `${RANK_NAMES[card.rank]} ${SUIT_GENITIVE[card.suit]}`;
}

/** Назва етапу гри (R-2.1). */
export function phaseName(phase: HandPhase): string {
  return PHASE_NAMES[phase];
}

/** Козир роздачі або «б/к» (R-3.2, R-3.4). */
export function trumpLabel(trump: Suit | null): string {
  return trump === null ? uk.noTrump : `${suitSymbol(trump)} ${suitName(trump)}`;
}

/** «Оля», «Оля і Бот 1», «Оля, Бот 1 і Бот 2». */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} і ${names.at(-1)}`;
}

/** Форма іменника для числа `n`: 1 взятка, 3 взятки, 5 взяток, 21 взятка. */
export function plural(n: number, [one, few, many]: PluralForms): string {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** Оголошення джокера у взятці (§6): «беру», «старша ♠» тощо. */
export function jokerCallLabel(call: JokerCall): string {
  switch (call.type) {
    case 'highTrump':
      return uk.jokerCall.highTrump;
    case 'high':
      return `${uk.jokerCall.high} ${suitSymbol(call.suit)}`;
    case 'low':
      return `${uk.jokerCall.low} ${suitSymbol(call.suit)}`;
    case 'take':
      return uk.jokerCall.take;
    case 'discard':
      return uk.jokerCall.discard;
  }
}
