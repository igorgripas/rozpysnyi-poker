import { type FormEvent, useState } from 'react';
import { uk } from '../i18n';
import { parseName, parseRoomCode } from '../net/client';
import { useClient, useClientState } from '../net/react';

export interface LobbyProps {
  /** Код із посилання-запрошення. */
  inviteCode: string | null;
  onForgetInvite: () => void;
}

/** Вхід: імʼя, створення кімнати або вхід за кодом чи посиланням. */
export function Lobby({ inviteCode, onForgetInvite }: LobbyProps) {
  const client = useClient();
  // Чому не вдалося повернутися в попередню кімнату — доки гравець не спробує щось інше.
  const { resumeError } = useClientState();
  const [name, setName] = useState(() => client.savedName());
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: (name: string) => Promise<{ message: string } | null>) {
    const validName = parseName(name);
    if (validName === null) {
      setError(uk.lobby.nameRequired);
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await action(validName);
    setBusy(false);
    if (failure !== null) setError(failure.message);
  }

  const alert = error ?? resumeError;

  const create = () => run((validName) => client.create(validName));

  const join = (event: FormEvent) => {
    event.preventDefault();
    const validCode = inviteCode ?? parseRoomCode(code);
    if (validCode === null) {
      setError(uk.lobby.badCode);
      return;
    }
    void run((validName) => client.join(validCode, validName));
  };

  return (
    <section className="lobby panel">
      {inviteCode !== null && <p className="lobby__invite">{uk.lobby.invited(inviteCode)}</p>}
      <form className="lobby__form" onSubmit={join} noValidate>
        <label className="field">
          <span>{uk.lobby.name}</span>
          <input
            name="name"
            autoComplete="nickname"
            maxLength={20}
            placeholder={uk.lobby.namePlaceholder}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {inviteCode === null ? (
          <>
            <button
              type="button"
              className="button button--primary"
              disabled={busy}
              onClick={() => void create()}
            >
              {uk.lobby.create}
            </button>
            <p className="lobby__or muted">{uk.lobby.or}</p>
            <div className="lobby__join">
              <label className="field">
                <span>{uk.lobby.code}</span>
                <input
                  name="code"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={5}
                  placeholder={uk.lobby.codePlaceholder}
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                />
              </label>
              <button type="submit" className="button" disabled={busy}>
                {uk.lobby.join}
              </button>
            </div>
          </>
        ) : (
          <>
            <button type="submit" className="button button--primary" disabled={busy}>
              {uk.lobby.joinInvited}
            </button>
            <button type="button" className="button" onClick={onForgetInvite}>
              {uk.lobby.otherRoom}
            </button>
          </>
        )}
        {alert !== null && (
          <p role="alert" className="error">
            {alert}
          </p>
        )}
      </form>
    </section>
  );
}
