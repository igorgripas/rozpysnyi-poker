import { useEffect, useId, useRef, useState } from 'react';
import { uk } from '../i18n';
import { SoundToggle } from './sound';
import { ThemeToggle } from './theme';
import { VibrationToggle } from './vibration';

/**
 * Меню налаштувань у шапці: вібрація, звук і тема за однією кнопкою ⚙, щоб на телефоні
 * назва гри вміщувалася в один рядок. Перемикачі змонтовані й у закритому меню
 * (звук розблоковується першим дотиком до сторінки), лише сховані.
 */
export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // Escape закриває меню й повертає фокус на ⚙, дотик поза меню — просто закриває.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <div className="settings" ref={root}>
      <button
        ref={button}
        type="button"
        className="icon-button"
        aria-label={uk.settings.label}
        aria-expanded={open}
        aria-controls={panelId}
        title={uk.settings.label}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">⚙{'︎'}</span>
      </button>
      <div
        id={panelId}
        className="settings__panel"
        role="group"
        aria-label={uk.settings.label}
        hidden={!open}
      >
        <VibrationToggle />
        <SoundToggle />
        <ThemeToggle />
      </div>
    </div>
  );
}
