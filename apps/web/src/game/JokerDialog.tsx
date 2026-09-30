import type { JokerCall } from '@poker/engine';
import { useEffect, useId, useRef } from 'react';
import { suitName, suitSymbol, uk } from '../i18n';

export interface JokerDialogProps {
  /** Допустимі оголошення для цього ходу (з `legalActions`). */
  calls: readonly JokerCall[];
  onChoose: (call: JokerCall) => void;
  onCancel: () => void;
}

type SuitCall = Extract<JokerCall, { type: 'high' | 'low' }>;

/**
 * Діалог оголошення джокера (§6). На заході: старший козир (R-6.1), старша масть (R-6.2),
 * маленька масть (R-6.3). Не на заході: беру (R-6.4) або скидаю (R-6.5).
 */
export function JokerDialog({ calls, onChoose, onCancel }: JokerDialogProps) {
  const titleId = useId();
  const has = (type: JokerCall['type']) => calls.find((call) => call.type === type);
  const suitCalls = (type: SuitCall['type']) =>
    calls.filter((call): call is SuitCall => call.type === type);
  const highTrump = has('highTrump');
  const take = has('take');
  const discard = has('discard');
  const dialog = useRef<HTMLDivElement>(null);

  // Фокус — на першому варіанті, щоб діалогом можна було керувати з клавіатури.
  useEffect(() => {
    dialog.current?.querySelector('button')?.focus();
  }, []);

  // Escape — скасувати.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  function option(call: JokerCall, label: string, hint: string) {
    return (
      <div className="joker-dialog__option">
        <button type="button" className="button joker-dialog__main" onClick={() => onChoose(call)}>
          {label}
        </button>
        <span className="joker-dialog__hint muted">{hint}</span>
      </div>
    );
  }

  function suitRow(type: SuitCall['type'], title: string, hint: string) {
    const row = suitCalls(type);
    if (row.length === 0) return null;
    return (
      <div className="joker-dialog__option">
        <span className="joker-dialog__label">{title}</span>
        <div className="joker-dialog__suits">
          {row.map((call) => (
            <button
              key={call.suit}
              type="button"
              className="button joker-dialog__suit"
              data-suit={call.suit}
              aria-label={suitCallName(call)}
              onClick={() => onChoose(call)}
            >
              {suitSymbol(call.suit)}
            </button>
          ))}
        </div>
        <span className="joker-dialog__hint muted">{hint}</span>
      </div>
    );
  }

  return (
    <div className="joker-dialog__backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialog}
        className="joker-dialog panel"
      >
        <h2 id={titleId} className="joker-dialog__title">
          {uk.jokerDialog.title}
        </h2>
        {highTrump && option(highTrump, uk.jokerDialog.highTrump, uk.jokerDialog.highTrumpHint)}
        {suitRow('high', uk.jokerDialog.high, uk.jokerDialog.highHint)}
        {suitRow('low', uk.jokerDialog.low, uk.jokerDialog.lowHint)}
        {take && option(take, uk.jokerDialog.take, uk.jokerDialog.takeHint)}
        {discard && option(discard, uk.jokerDialog.discard, uk.jokerDialog.discardHint)}
        <button type="button" className="button joker-dialog__cancel" onClick={onCancel}>
          {uk.jokerDialog.cancel}
        </button>
      </div>
    </div>
  );
}

/** Повна назва оголошення з мастю для доступності: «Старша піка». */
function suitCallName(call: SuitCall): string {
  const name = call.type === 'high' ? uk.jokerDialog.high : uk.jokerDialog.low;
  return `${name} ${suitName(call.suit)}`;
}
