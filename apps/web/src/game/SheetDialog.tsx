import type { WirePlayerView } from '@poker/protocol';
import { useEffect, useRef } from 'react';
import { uk } from '../i18n';
import { GameOptions } from './GameOptions';
import { ScoreSheet } from './ScoreSheet';

export interface SheetDialogProps {
  table: WirePlayerView['table'];
  /** Опції гри (R-10.1): ввімкнені показуються над таблицею. */
  options: WirePlayerView['options'];
  names: readonly string[];
  onClose: () => void;
  /** Відкрити звіт про баг (T52): таблиця закривається, відкривається діалог звіту. */
  onReportBug: () => void;
}

/** Таблиця гри поверх столу (R-8.5): відкривається в будь-який момент гри. */
export function SheetDialog({ table, options, names, onClose, onReportBug }: SheetDialogProps) {
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    close.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="sheet-dialog__backdrop">
      <div role="dialog" aria-modal="true" aria-label={uk.sheet.title} className="sheet-dialog">
        <div className="sheet-dialog__header">
          <h2 className="sheet-dialog__title">{uk.sheet.title}</h2>
          <button ref={close} type="button" className="button" onClick={onClose}>
            {uk.sheet.close}
          </button>
        </div>
        <GameOptions options={options} />
        <ScoreSheet table={table} names={names} />
        <button type="button" className="button bug-report-button" onClick={onReportBug}>
          {uk.bugReport.open}
        </button>
      </div>
    </div>
  );
}
