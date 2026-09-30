/** Як вдалося поділитися посиланням. */
export type ShareOutcome = 'shared' | 'copied' | 'failed';

/** Системне меню «Поділитися», а без нього — копіювання посилання в буфер обміну. */
export async function shareLink(data: {
  title: string;
  text: string;
  url: string;
}): Promise<ShareOutcome> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (error) {
      // Гравець закрив меню — це не помилка.
      if (error instanceof DOMException && error.name === 'AbortError') return 'shared';
    }
  }
  try {
    await navigator.clipboard.writeText(data.url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
