import { createGame } from '@poker/engine';
import { BUG_DESCRIPTION_MAX_LENGTH } from '@poker/protocol';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderAt } from './support/render';
import { advanceUntil, findState } from './support/views';

const ISSUE_URL = 'https://github.com/owner/repo/issues/42';

/** Відкриває діалог звіту про баг з таблиці гри. */
async function openReport(user: ReturnType<typeof renderAt>['user']) {
  await user.click(screen.getByRole('button', { name: 'Таблиця' }));
  await user.click(screen.getByRole('button', { name: 'Повідомити про баг' }));
  return screen.getByRole('dialog', { name: 'Повідомити про баг' });
}

describe('кнопка «Повідомити про баг» (T52)', () => {
  it('з таблиці гри: опис надсилається на сервер, гравець бачить посилання на звіт', async () => {
    const state = findState(3, (s) => s.status === 'playing');
    const { user, connection } = renderAt(state, 0);
    connection.on('game:reportBug', () => ({ ok: true, data: { url: ISSUE_URL } }));

    const dialog = await openReport(user);
    // Таблиця закривається, щоб діалоги не накладалися.
    expect(screen.queryByRole('dialog', { name: 'Таблиця гри' })).not.toBeInTheDocument();
    const send = within(dialog).getByRole('button', { name: 'Надіслати' });
    expect(send).toBeDisabled();

    const text = within(dialog).getByRole('textbox', { name: 'Що сталося?' });
    expect(text).toHaveAttribute('maxlength', String(BUG_DESCRIPTION_MAX_LENGTH));
    await user.type(text, 'Бот зіграв не в масть');
    await user.click(send);

    expect(connection.requests).toContainEqual({
      event: 'game:reportBug',
      payload: { description: 'Бот зіграв не в масть' },
    });
    expect(within(dialog).getByRole('status')).toHaveTextContent('Дякуємо');
    expect(within(dialog).getByRole('link', { name: 'Відкрити звіт' })).toHaveAttribute(
      'href',
      ISSUE_URL,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Закрити' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('посеред гри звіт відкладено до її кінця: без посилання на issue', async () => {
    const state = findState(3, (s) => s.status === 'playing');
    const { user, connection } = renderAt(state, 0);
    connection.on('game:reportBug', () => ({ ok: true, data: { url: null } }));

    const dialog = await openReport(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Що сталося?' }), 'баг');
    await user.click(within(dialog).getByRole('button', { name: 'Надіслати' }));
    expect(within(dialog).getByRole('status')).toHaveTextContent('після завершення гри');
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument();
  });

  it('помилку сервера показано в діалозі, текст не губиться', async () => {
    const state = findState(3, (s) => s.status === 'playing');
    const { user, connection } = renderAt(state, 0);
    connection.on('game:reportBug', () => ({
      ok: false,
      error: { code: 'rateLimited', message: 'Ви вже надіслали кілька звітів' },
    }));

    const dialog = await openReport(user);
    const text = within(dialog).getByRole('textbox', { name: 'Що сталося?' });
    await user.type(text, 'баг');
    await user.click(within(dialog).getByRole('button', { name: 'Надіслати' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Ви вже надіслали кілька звітів');
    expect(text).toHaveValue('баг');
  });

  it('скасування чи Escape закривають діалог без запиту', async () => {
    const state = findState(3, (s) => s.status === 'playing');
    const { user, connection } = renderAt(state, 0);
    const dialog = await openReport(user);
    await user.click(within(dialog).getByRole('button', { name: 'Скасувати' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await openReport(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(connection.requests.some((r) => r.event === 'game:reportBug')).toBe(false);
  });

  it('на фінальному екрані теж можна повідомити про баг', async () => {
    const state = advanceUntil(createGame(1, 3), (s) => s.status === 'finished');
    const { user } = renderAt(state, 0);
    await user.click(screen.getByRole('button', { name: 'Повідомити про баг' }));
    expect(screen.getByRole('dialog', { name: 'Повідомити про баг' })).toBeInTheDocument();
  });
});
