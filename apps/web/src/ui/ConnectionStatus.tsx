import { uk } from '../i18n';
import { useClientState } from '../net/react';

/** Індикатор звʼязку в шапці: кольорова крапка з назвою стану. */
export function ConnectionIndicator() {
  const { connection } = useClientState();
  const label = uk.connection.indicator[connection];
  return (
    <span
      className="net-dot"
      data-status={connection}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}

/** Повідомлення про обрив звʼязку, перезапуск сервера або застарілу версію клієнта. */
export function ConnectionBanner() {
  const { connection } = useClientState();
  if (connection === 'offline') {
    return (
      <p role="alert" className="net-banner">
        <strong>{uk.connection.offline}</strong> {uk.connection.reconnecting}
      </p>
    );
  }
  if (connection === 'waking') {
    return (
      <p role="alert" className="net-banner">
        {uk.connection.waking}
      </p>
    );
  }
  if (connection === 'outdated') {
    return (
      <div role="alert" className="net-banner">
        <span>{uk.connection.outdated}</span>
        <button type="button" className="button" onClick={() => window.location.reload()}>
          {uk.connection.reload}
        </button>
      </div>
    );
  }
  return null;
}
