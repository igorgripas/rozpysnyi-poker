/** Версія формату логу дій; збільшується при несумісних змінах replay. */
export const ENGINE_LOG_VERSION = 1;
export { formatScore } from './formatScore.js';
export {
  DECK_SIZE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  RANKS,
  SUITS,
  assertPlayerCount,
  cardId,
  compareRank,
  createDeck,
  isJoker,
  maxCardsPerHand,
} from './cards.js';
export type { Card, JokerCard, Rank, StandardCard, Suit } from './cards.js';
export { createRng, shuffle } from './rng.js';
export type { Rng } from './rng.js';
export { deal } from './deal.js';
export type { DealResult } from './deal.js';
export { chooseFirstDealer, createSchedule, dealerForHand } from './schedule.js';
export type { HandPhase, HandSpec, TrumpRule } from './schedule.js';
export { determineTrump } from './trump.js';
export type { TrumpResult } from './trump.js';
export {
  biddingOrder,
  forbiddenDealerBid,
  handHasBidding,
  isLegalBid,
  legalBids,
} from './bidding.js';
export {
  firstLeader,
  isLegalJokerCall,
  isLegalPlay,
  legalJokerCalls,
  legalPlays,
  trickWinner,
} from './trick.js';
export type { JokerCall, PlayedJoker, TrickCard } from './trick.js';
