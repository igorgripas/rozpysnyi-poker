import { MAX_PLAYERS, MIN_PLAYERS } from '@poker/engine';
import type { ClientEvent, ClientMessageInput, RoomState } from '@poker/protocol';
import { useId, useState } from 'react';
import { uk } from '../i18n';
import { useClient } from '../net/react';
import { VoiceControls, useVoiceState } from '../voice/VoiceControls';
import { shareLink } from './share';

type HostEvent = 'room:addBot' | 'room:removeBot' | 'room:shuffle' | 'room:options' | 'room:start';

/** Кімната очікування: гравці на місцях (R-9.1), запрошення й керування хоста. */
export function WaitingRoom({ room }: { room: RoomState }) {
  const client = useClient();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const isHost = room.hostId === room.you;
  const count = room.seats.length;
  const url = new URL(room.link, window.location.origin).href;
  const speaking = useVoiceState()?.speaking;

  async function send<E extends HostEvent & ClientEvent>(event: E, payload: ClientMessageInput<E>) {
    setError(null);
    const failure = await client.send(event, payload);
    if (failure !== null) setError(failure.message);
  }

  async function share() {
    const outcome = await shareLink({
      title: uk.room.shareTitle,
      text: uk.room.shareText(room.code),
      url,
    });
    setStatus(outcome === 'copied' ? uk.room.copied : null);
  }

  return (
    <section className="waiting">
      <div className="panel waiting__invite">
        <h2>{uk.room.title(room.code)}</h2>
        <p className="muted">{uk.room.inviteHint}</p>
        <p className="waiting__link">
          <a href={url}>{url}</a>
        </p>
        <button type="button" className="button button--primary" onClick={() => void share()}>
          {uk.room.share}
        </button>
        <p role="status" className="muted">
          {status}
        </p>
      </div>

      <div className="panel waiting__players">
        <div className="waiting__heading">
          <h3>
            {uk.room.players} · {count}/{MAX_PLAYERS}
          </h3>
          <VoiceControls />
        </div>
        <ol className="seats" aria-label={uk.room.players}>
          {room.seats.map((seat, index) => (
            <li key={seat.id} className="seat" data-speaking={speaking?.has(seat.id) || undefined}>
              <span className="seat__number">{index + 1}</span>
              <span className="seat__name">
                {seat.name}
                {speaking?.has(seat.id) && <span className="sr-only">, {uk.voice.speaking}</span>}
              </span>
              <span className="seat__badges">
                {seat.id === room.hostId && <span className="badge">{uk.room.host}</span>}
                {seat.id === room.you && <span className="badge badge--accent">{uk.room.you}</span>}
                {seat.kind === 'bot' && <span className="badge">{uk.room.bot}</span>}
                {!seat.connected && <span className="badge badge--muted">{uk.room.offline}</span>}
              </span>
              {isHost && seat.kind === 'bot' && (
                <button
                  type="button"
                  className="icon-button icon-button--small"
                  aria-label={uk.room.removeBot(seat.name)}
                  onClick={() => void send('room:removeBot', { seat: index })}
                >
                  <span aria-hidden="true">×</span>
                </button>
              )}
            </li>
          ))}
        </ol>

        <fieldset className="waiting__options">
          <legend>{uk.room.options}</legend>
          <OptionSwitch
            label={uk.room.dark}
            hint={uk.room.darkHint}
            checked={room.options.dark}
            disabled={!isHost}
            onChange={(dark) => void send('room:options', { ...room.options, dark })}
          />
          <OptionSwitch
            label={uk.room.zeroLimit}
            hint={uk.room.zeroLimitHint}
            checked={room.options.zeroLimit}
            disabled={!isHost}
            onChange={(zeroLimit) => void send('room:options', { ...room.options, zeroLimit })}
          />
        </fieldset>

        {isHost ? (
          <div className="waiting__actions">
            <button
              type="button"
              className="button"
              disabled={count >= MAX_PLAYERS}
              onClick={() => void send('room:addBot', {})}
            >
              {uk.room.addBot}
            </button>
            <button
              type="button"
              className="button"
              disabled={count < 2}
              onClick={() => void send('room:shuffle', {})}
            >
              {uk.room.shuffle}
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={count < MIN_PLAYERS}
              onClick={() => void send('room:start', {})}
            >
              {uk.room.start}
            </button>
            {count < MIN_PLAYERS && <p className="muted">{uk.room.needPlayers(MIN_PLAYERS)}</p>}
          </div>
        ) : (
          <p className="muted">{uk.room.waitingHost}</p>
        )}
        {error !== null && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="button" className="button waiting__leave" onClick={() => void client.leave()}>
          {uk.room.leave}
        </button>
      </div>
    </section>
  );
}

interface OptionSwitchProps {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}

/** Перемикач опції кімнати (§10): змінює лише хост, бачать усі (R-10.1). */
function OptionSwitch({ label, hint, checked, disabled, onChange }: OptionSwitchProps) {
  const hintId = useId();
  return (
    <label className="option">
      <input
        type="checkbox"
        role="switch"
        className="option__input"
        checked={checked}
        disabled={disabled}
        aria-describedby={hintId}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="option__text">
        <span className="option__label">{label}</span>
        <span id={hintId} className="option__hint muted">
          {hint}
        </span>
      </span>
    </label>
  );
}
