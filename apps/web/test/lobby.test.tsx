import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { PokerClient, SESSION_STORAGE_KEY, NAME_STORAGE_KEY } from '../src/net/client';
import { FakeConnection, TOKEN, roomState, session } from './support/fakeConnection';

function setup(path = '/') {
  window.history.replaceState(null, '', path);
  const connection = new FakeConnection();
  const client = new PokerClient(connection);
  const user = userEvent.setup();
  return { connection, client, user, render: () => render(<App client={client} />) };
}

describe('лобі', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));

  it('створює кімнату з введеним імʼям і запамʼятовує токен', async () => {
    const { connection, user, render } = setup();
    connection.on('room:create', () => {
      queueMicrotask(() => connection.pushRoom(roomState()));
      return { ok: true, data: session() };
    });
    render();
    await user.type(screen.getByLabelText('Ваше імʼя'), '  Оля ');
    await user.click(screen.getByRole('button', { name: 'Створити кімнату' }));
    expect(connection.requests).toContainEqual({ event: 'room:create', payload: { name: 'Оля' } });
    expect(await screen.findByRole('heading', { name: /Кімната ABCDE/ })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) ?? '')).toEqual({
      code: 'ABCDE',
      token: TOKEN,
    });
    expect(localStorage.getItem(NAME_STORAGE_KEY)).toBe('Оля');
    expect(window.location.pathname).toBe('/r/ABCDE');
  });

  it('не дає створити кімнату без імені', async () => {
    const { connection, user, render } = setup();
    render();
    await user.click(screen.getByRole('button', { name: 'Створити кімнату' }));
    expect(connection.requests).toEqual([]);
    expect(screen.getByRole('alert')).toHaveTextContent('Введіть імʼя');
  });

  it('підставляє збережене імʼя', () => {
    localStorage.setItem(NAME_STORAGE_KEY, 'Тарас');
    setup().render();
    expect(screen.getByLabelText('Ваше імʼя')).toHaveValue('Тарас');
  });

  it('входить у кімнату за кодом (регістр не важливий)', async () => {
    const { connection, user, render } = setup();
    connection.on('room:join', () => {
      queueMicrotask(() => connection.pushRoom(roomState({ you: 'p2' })));
      return { ok: true, data: session('ABCDE', 'p2') };
    });
    render();
    await user.type(screen.getByLabelText('Ваше імʼя'), 'Петро');
    await user.type(screen.getByLabelText('Код кімнати'), 'abcde');
    await user.click(screen.getByRole('button', { name: 'Увійти' }));
    expect(connection.requests).toContainEqual({
      event: 'room:join',
      payload: { code: 'ABCDE', name: 'Петро' },
    });
    expect(await screen.findByRole('heading', { name: /Кімната ABCDE/ })).toBeInTheDocument();
  });

  it('перевіряє формат коду до запиту', async () => {
    const { connection, user, render } = setup();
    render();
    await user.type(screen.getByLabelText('Ваше імʼя'), 'Петро');
    await user.type(screen.getByLabelText('Код кімнати'), 'AB');
    await user.click(screen.getByRole('button', { name: 'Увійти' }));
    expect(connection.requests).toEqual([]);
    expect(screen.getByRole('alert')).toHaveTextContent('Код кімнати — 5 символів');
  });

  it('показує помилку сервера, якщо кімнати немає', async () => {
    const { connection, user, render } = setup();
    connection.on('room:join', () => ({
      ok: false,
      error: { code: 'roomNotFound', message: 'Кімнати ABCDE немає' },
    }));
    render();
    await user.type(screen.getByLabelText('Ваше імʼя'), 'Петро');
    await user.type(screen.getByLabelText('Код кімнати'), 'ABCDE');
    await user.click(screen.getByRole('button', { name: 'Увійти' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Кімнати ABCDE немає');
  });

  it('посилання-запрошення /r/КОД підставляє код кімнати', async () => {
    const { connection, user, render } = setup('/r/xyz23');
    connection.on('room:join', () => ({ ok: true, data: session('XYZ23', 'p2') }));
    render();
    expect(screen.getByText(/Вас запросили в кімнату XYZ23/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Ваше імʼя'), 'Петро');
    await user.click(screen.getByRole('button', { name: 'Увійти в кімнату' }));
    expect(connection.requests).toContainEqual({
      event: 'room:join',
      payload: { code: 'XYZ23', name: 'Петро' },
    });
  });

  it('повертається в кімнату за збереженим токеном', async () => {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ code: 'ABCDE', token: TOKEN }));
    const { connection, render } = setup('/r/ABCDE');
    connection.on('room:resume', () => {
      queueMicrotask(() => connection.pushRoom(roomState()));
      return { ok: true, data: session() };
    });
    render();
    expect(await screen.findByRole('heading', { name: /Кімната ABCDE/ })).toBeInTheDocument();
    expect(connection.requests).toEqual([
      { event: 'room:resume', payload: { code: 'ABCDE', token: TOKEN } },
    ]);
  });

  it('забуває недійсний токен і показує лобі', async () => {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ code: 'ABCDE', token: TOKEN }));
    const { connection, render } = setup();
    connection.on('room:resume', () => ({
      ok: false,
      error: { code: 'roomNotFound', message: 'Кімнати ABCDE немає' },
    }));
    render();
    expect(await screen.findByRole('button', { name: 'Створити кімнату' })).toBeInTheDocument();
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('адреса кімнати /r/КОД зберігає параметри запиту (?server=, ?trickPause=)', async () => {
    const { connection, user, render } = setup(
      '/?server=http%3A%2F%2Flocalhost%3A3101&trickPause=0',
    );
    connection.on('room:create', () => {
      queueMicrotask(() => connection.pushRoom(roomState()));
      return { ok: true, data: session() };
    });
    render();
    await user.type(screen.getByLabelText('Ваше імʼя'), 'Оля');
    await user.click(screen.getByRole('button', { name: 'Створити кімнату' }));
    expect(await screen.findByRole('heading', { name: /Кімната ABCDE/ })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/r/ABCDE');
    expect(window.location.search).toBe('?server=http%3A%2F%2Flocalhost%3A3101&trickPause=0');
  });

  it('«Інша кімната» веде на головну, не губячи параметри запиту', async () => {
    const { user, render } = setup('/r/XYZ23?trickPause=0');
    render();
    await user.click(screen.getByRole('button', { name: 'Інша кімната' }));
    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('?trickPause=0');
  });

  it('запрошення в іншу кімнату не використовує старий токен', () => {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ code: 'ABCDE', token: TOKEN }));
    const { connection, render } = setup('/r/XYZ23');
    render();
    expect(connection.requests).toEqual([]);
    expect(screen.getByText(/Вас запросили в кімнату XYZ23/)).toBeInTheDocument();
  });
});
