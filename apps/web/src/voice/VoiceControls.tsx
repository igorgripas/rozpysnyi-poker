import { type ReactNode, createContext, use, useSyncExternalStore } from 'react';
import { uk } from '../i18n';
import { useClientState } from '../net/react';
import type { VoiceChat, VoiceState } from './VoiceChat';

const VoiceContext = createContext<VoiceChat | null>(null);

/** Голосовий чат застосунку; `null` — браузер без WebRTC. */
export function VoiceProvider({
  voice,
  children,
}: {
  voice: VoiceChat | null;
  children: ReactNode;
}) {
  return <VoiceContext value={voice}>{children}</VoiceContext>;
}

const noop = () => () => {};
const NO_VOICE: VoiceState | null = null;

/** Стан голосу або `null`, якщо голосу немає (без WebRTC чи поза провайдером). */
export function useVoiceState(): VoiceState | null {
  const voice = use(VoiceContext);
  return useSyncExternalStore(voice?.subscribe ?? noop, voice?.getState ?? (() => NO_VOICE));
}

/** Чи говорить гравець зараз (індикатор у картці гравця). */
export function useSpeaking(playerId: string): boolean {
  return useVoiceState()?.speaking.has(playerId) ?? false;
}

/**
 * Кнопки голосового чату: мікрофон (вимкнений за замовчуванням) і звук інших гравців.
 * На HTTP мікрофон недоступний — кнопка пояснює чому.
 */
export function VoiceControls() {
  const voice = use(VoiceContext);
  const state = useVoiceState();
  const { room } = useClientState();
  if (voice === null || state === null) return null;
  const failed = state.failed.map((id) => room?.seats.find((s) => s.id === id)?.name ?? id);
  const micOn = state.mic === 'on';
  return (
    <div className="voice" role="group" aria-label={uk.voice.title}>
      <button
        type="button"
        className="icon-button icon-button--small voice__mic"
        aria-label={uk.voice.mic}
        aria-pressed={micOn}
        aria-busy={state.mic === 'starting' || undefined}
        title={micOn ? uk.voice.micOn : uk.voice.micOff}
        onClick={() => void voice.setMic(!micOn)}
      >
        <span aria-hidden="true">🎙</span>
      </button>
      <button
        type="button"
        className="icon-button icon-button--small"
        aria-label={uk.voice.muteOthers}
        aria-pressed={state.othersMuted}
        title={uk.voice.muteOthers}
        onClick={() => voice.setOthersMuted(!state.othersMuted)}
      >
        <span aria-hidden="true">{state.othersMuted ? '🔇' : '🔈'}</span>
      </button>
      <p role="status" className="voice__notice">
        {state.notice ?? (failed.length > 0 ? uk.voice.failed(failed) : null)}
      </p>
    </div>
  );
}
