import type { WirePlayerView } from '@poker/protocol';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { uk } from '../i18n';

export const SOUND_STORAGE_KEY = 'poker.sound';

export type SoundName = 'turn' | 'card' | 'trick' | 'handEnd';

/** Тон звуку: частота, Гц; початок від моменту звуку й тривалість, с. */
export interface Tone {
  readonly frequency: number;
  readonly at: number;
  readonly duration: number;
}

/** Звуки синтезуються Web Audio — без зовнішніх файлів. */
export const SOUNDS: Record<SoundName, readonly Tone[]> = {
  // Свій хід: два висхідні тони.
  turn: [
    { frequency: 660, at: 0, duration: 0.12 },
    { frequency: 880, at: 0.13, duration: 0.16 },
  ],
  // Зіграна карта: короткий низький «тук».
  card: [{ frequency: 330, at: 0, duration: 0.06 }],
  // Взятка: одна мʼяка нота після звуку карти.
  trick: [{ frequency: 523, at: 0.12, duration: 0.14 }],
  // Кінець роздачі: три низхідні ноти.
  handEnd: [
    { frequency: 784, at: 0.35, duration: 0.14 },
    { frequency: 659, at: 0.5, duration: 0.14 },
    { frequency: 523, at: 0.65, duration: 0.24 },
  ],
};

/** Гучність: звуки тихі. */
const VOLUME = 0.06;

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Звук увімкнений за замовчуванням; вибір гравця — у localStorage. */
function soundEnabled(): boolean {
  return localStorage.getItem(SOUND_STORAGE_KEY) !== 'off';
}

function setSoundEnabled(enabled: boolean): void {
  localStorage.setItem(SOUND_STORAGE_KEY, enabled ? 'on' : 'off');
  for (const listener of listeners) listener();
}

function soundSupported(): boolean {
  return typeof globalThis.AudioContext === 'function';
}

/** Аудіоконтекст зʼявляється лише після першої дії користувача (вимога браузерів). */
let context: AudioContext | null = null;

function unlock(): void {
  if (!soundSupported()) return;
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume();
}

/** Скидає аудіоконтекст (для тестів). */
export function resetSound(): void {
  context = null;
}

/** Грає звук, якщо звук увімкнено й користувач уже взаємодіяв зі сторінкою. */
export function playSound(name: SoundName): void {
  if (context === null || !soundEnabled()) return;
  const now = context.currentTime;
  for (const tone of SOUNDS[name]) {
    const start = now + tone.at;
    const end = start + tone.duration;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(tone.frequency, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(VOLUME, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(end);
  }
}

/** Вмикає звук після першої дії користувача на сторінці. */
function useSoundUnlock(): void {
  useEffect(() => {
    const events = ['pointerdown', 'keydown'] as const;
    for (const event of events) window.addEventListener(event, unlock, { capture: true });
    return () => {
      for (const event of events) window.removeEventListener(event, unlock, { capture: true });
    };
  }, []);
}

/** Скільки карт уже зіграно в роздачі. */
function cardsPlayed(view: WirePlayerView): number {
  return view.taken.reduce((sum, n) => sum + n, 0) * view.playerCount + view.trick.length;
}

/**
 * Звуки гри за станом із сервера: зіграна карта, взятка, кінець роздачі; «ваш хід» —
 * за показаним станом (після паузи взятки).
 */
export function useGameSounds(latest: WirePlayerView, yourTurn: boolean): void {
  useSoundUnlock();
  const previous = useRef({ view: latest, yourTurn });
  useEffect(() => {
    const before = previous.current.view;
    previous.current.view = latest;
    if (before === latest) return;
    const handOver =
      latest.spec.index !== before.spec.index ||
      (latest.status === 'finished' && before.status !== 'finished');
    const tricks = (view: WirePlayerView) => view.taken.reduce((sum, n) => sum + n, 0);
    const trick = handOver || tricks(latest) > tricks(before);
    if (trick || cardsPlayed(latest) > cardsPlayed(before)) playSound('card');
    if (trick) playSound('trick');
    if (handOver) playSound('handEnd');
  }, [latest]);
  useEffect(() => {
    if (yourTurn && !previous.current.yourTurn) playSound('turn');
    previous.current.yourTurn = yourTurn;
  }, [yourTurn]);
}

/** Перемикач звуку в меню налаштувань; без Web Audio не показується. */
export function SoundToggle() {
  const enabled = useSyncExternalStore(subscribe, soundEnabled);
  useSoundUnlock();
  if (!soundSupported()) return null;
  return (
    <button
      type="button"
      className="settings__item"
      aria-label={uk.sound.label}
      aria-pressed={enabled}
      title={enabled ? uk.sound.on : uk.sound.off}
      onClick={() => setSoundEnabled(!enabled)}
    >
      <span aria-hidden="true">{enabled ? '🔊' : '🔇'}</span>
      <span className="settings__label">{uk.sound.label}</span>
      <span className="settings__state">{enabled ? uk.settings.on : uk.settings.off}</span>
    </button>
  );
}
