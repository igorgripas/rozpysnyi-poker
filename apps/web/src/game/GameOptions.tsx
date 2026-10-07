import type { WirePlayerView } from '@poker/protocol';
import { uk } from '../i18n';

/**
 * Ввімкнені опції гри (R-10.1) одним компактним рядком: гравець, що повернувся в гру,
 * бачить, за якими правилами вона йде, а підсумок гри з «Темною» (бали ×2) — пояснено.
 */
export function GameOptions({ options }: { options: WirePlayerView['options'] }) {
  const enabled = [options.dark && uk.room.dark, options.zeroLimit && uk.room.zeroLimit].filter(
    (name) => name !== false,
  );
  if (enabled.length === 0) {
    return <p className="game-options muted">{uk.sheet.noOptions}</p>;
  }
  return (
    <div className="game-options">
      <span aria-hidden="true">{uk.room.options}:</span>
      <ul aria-label={uk.room.options}>
        {enabled.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </div>
  );
}
