/** Типографський мінус (U+2212) для від'ємних балів у таблиці гри. */
const MINUS_SIGN = '−';

/** Форматує бали для таблиці гри (R-8.2): `+30`, `−30`, `0`. */
export function formatScore(points: number): string {
  if (points > 0) return `+${points}`;
  if (points < 0) return `${MINUS_SIGN}${-points}`;
  return '0';
}
