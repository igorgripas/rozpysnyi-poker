import { MAX_PLAYERS, MIN_PLAYERS } from '@poker/engine';
import type { ClientEvent, ClientMessageInput, RoomState } from '@poker/protocol';
import { useState } from 'react';
import { uk } from '../i18n';
import { useClient } from '../net/react';
import { shareLink } from './share';

type HostEvent = 'room:addBot' | 'room:removeBot' | 'room:shuffle' | 'room:start';

/** Кімната очікування: гравці на місцях (R-9.1), запрошення й керування хоста. */
export function WaitingRoom({ room }: { room: RoomState }) {
  const client = useClient();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const isHost = room.hostId === room.you;
  const count = room.seats.length;
  const url = new URL(room.link, window.location.origin).href;

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
        <h3>
          {uk.room.players} · {count}/{MAX_PLAYERS}
        </h3>
        <ol className="seats" aria-label={uk.room.players}>
          {room.seats.map((seat, index) => (
            <li key={seat.id} className="seat">
              <span className="seat__number">{index + 1}</span>
              <span className="seat__name">{seat.name}</span>
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
      </div>
    </section>
  );
}
