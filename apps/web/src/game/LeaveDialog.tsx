import { useEffect, useId, useRef } from 'react';
import { uk } from '../i18n';

export interface LeaveDialogProps {
  onLeave: () => void;
  onCancel: () => void;
}

/** Підтвердження виходу посеред гри (T180): за гравця ходитиме бот, повернутися можна. */
export function LeaveDialog({ onLeave, onCancel }: LeaveDialogProps) {
  const titleId = useId();
  const hintId = useId();
  const stay = useRef<HTMLButtonElement>(null);

  // Фокус — на безпечному варіанті «Залишитися».
  useEffect(() => {
    stay.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="joker-dialog__backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hintId}
        className="joker-dialog panel"
      >
        <h2 id={titleId} className="joker-dialog__title">
          {uk.game.leaveTitle}
        </h2>
        <p id={hintId} className="leave-dialog__hint">
          {uk.game.leaveHint}
        </p>
        <div className="bug-dialog__actions">
          <button ref={stay} type="button" className="button" onClick={onCancel}>
            {uk.game.leaveCancel}
          </button>
          <button type="button" className="button button--primary" onClick={onLeave}>
            {uk.game.leaveConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}
