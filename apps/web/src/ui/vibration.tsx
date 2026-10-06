import { useEffect, useRef, useSyncExternalStore } from 'react';
import { uk } from '../i18n';

export const VIBRATION_STORAGE_KEY = 'poker.vibration';

/** Короткий подвійний імпульс, мс. */
const TURN_PATTERN = [80, 60, 80];

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Вібрація увімкнена за замовчуванням; вибір гравця — у localStorage. */
function vibrationEnabled(): boolean {
  return localStorage.getItem(VIBRATION_STORAGE_KEY) !== 'off';
}

function setVibrationEnabled(enabled: boolean): void {
  localStorage.setItem(VIBRATION_STORAGE_KEY, enabled ? 'on' : 'off');
  for (const listener of listeners) listener();
}

function vibrationSupported(): boolean {
  return typeof navigator.vibrate === 'function';
}

/** Вібрує, коли настає хід гравця (якщо пристрій уміє і гравець не вимкнув). */
export function useTurnVibration(yourTurn: boolean): void {
  const enabled = useSyncExternalStore(subscribe, vibrationEnabled);
  const previous = useRef(yourTurn);
  useEffect(() => {
    if (yourTurn && !previous.current && enabled && vibrationSupported()) {
      navigator.vibrate(TURN_PATTERN);
    }
    previous.current = yourTurn;
  }, [yourTurn, enabled]);
}

/** Перемикач вібрації в меню налаштувань; без підтримки вібрації не показується. */
export function VibrationToggle() {
  const enabled = useSyncExternalStore(subscribe, vibrationEnabled);
  if (!vibrationSupported()) return null;
  return (
    <button
      type="button"
      className="settings__item"
      aria-label={uk.vibration.label}
      aria-pressed={enabled}
      title={enabled ? uk.vibration.on : uk.vibration.off}
      onClick={() => setVibrationEnabled(!enabled)}
    >
      <span aria-hidden="true">{enabled ? '📳' : '📴'}</span>
      {uk.vibration.label}
    </button>
  );
}
