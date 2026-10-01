import { BUG_DESCRIPTION_MAX_LENGTH } from '@poker/protocol';
import { useEffect, useId, useRef, useState } from 'react';
import { uk } from '../i18n';
import { useClient } from '../net/react';

export interface BugReportDialogProps {
  onClose: () => void;
}

/** Діалог «Повідомити про баг» (AUTOPILOT §6): опис гравця, replay гри додає сервер. */
export function BugReportDialog({ onClose }: BugReportDialogProps) {
  const client = useClient();
  const titleId = useId();
  const textId = useId();
  const hintId = useId();
  const text = useRef<HTMLTextAreaElement>(null);
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    text.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function send() {
    setSending(true);
    setError(null);
    const result = await client.reportBug(description);
    setSending(false);
    if (result.ok) setUrl(result.data.url);
    else setError(result.error.message);
  }

  return (
    <div className="joker-dialog__backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="joker-dialog bug-dialog panel"
      >
        <h2 id={titleId} className="joker-dialog__title">
          {uk.bugReport.title}
        </h2>
        {url === null ? (
          <form
            className="bug-dialog__form"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label htmlFor={textId}>{uk.bugReport.label}</label>
            <textarea
              ref={text}
              id={textId}
              className="bug-dialog__text"
              rows={4}
              maxLength={BUG_DESCRIPTION_MAX_LENGTH}
              aria-describedby={hintId}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <span id={hintId} className="muted">
              {uk.bugReport.hint}
            </span>
            {error !== null && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <div className="bug-dialog__actions">
              <button type="button" className="button" onClick={onClose}>
                {uk.bugReport.cancel}
              </button>
              <button
                type="submit"
                className="button button--primary"
                disabled={sending || description.trim() === ''}
              >
                {sending ? uk.bugReport.sending : uk.bugReport.send}
              </button>
            </div>
          </form>
        ) : (
          <>
            <p role="status">{uk.bugReport.thanks}</p>
            <a href={url} target="_blank" rel="noreferrer">
              {uk.bugReport.link}
            </a>
            <button type="button" className="button" onClick={onClose}>
              {uk.bugReport.close}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
