import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { PokerClient } from '../src/net/client';
import { AppUpdates } from '../src/update';
import { FakeConnection } from './support/fakeConnection';

/** Підмінний service worker: стан і повідомлення від сторінки. */
class FakeWorker extends EventTarget {
  readonly messages: unknown[] = [];
  constructor(public state: ServiceWorkerState = 'installing') {
    super();
  }
  postMessage(message: unknown): void {
    this.messages.push(message);
  }
  /** Браузер перевів worker у новий стан. */
  become(state: ServiceWorkerState): void {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  readonly update = vi.fn(() => Promise.resolve());
  /** Браузер знайшов новий sw.js і почав його встановлювати. */
  found(): FakeWorker {
    const worker = new FakeWorker();
    this.installing = worker;
    this.dispatchEvent(new Event('updatefound'));
    return worker;
  }
}

class FakeContainer extends EventTarget {
  constructor(public controller: FakeWorker | null) {
    super();
  }
  /** Сторінку взяв під контроль новий worker. */
  takeOver(worker: FakeWorker): void {
    this.controller = worker;
    this.dispatchEvent(new Event('controllerchange'));
  }
}

function setup({ controlled = true } = {}) {
  const registration = new FakeRegistration();
  const container = new FakeContainer(controlled ? new FakeWorker('activated') : null);
  const reload = vi.fn();
  const updates = new AppUpdates(reload);
  updates.watch(
    registration as unknown as ServiceWorkerRegistration,
    container as unknown as ServiceWorkerContainer,
  );
  return { registration, container, reload, updates };
}

describe('оновлення застосунку (service worker)', () => {
  it('новий service worker встановився — доступна нова версія', () => {
    const { registration, updates } = setup();
    expect(updates.getState().available).toBe(false);
    const worker = registration.found();
    expect(updates.getState().available).toBe(false);
    worker.become('installed');
    expect(updates.getState().available).toBe(true);
  });

  it('перше встановлення (сторінкою ще не керує service worker) — не оновлення', () => {
    const { registration, updates } = setup({ controlled: false });
    registration.found().become('installed');
    expect(updates.getState().available).toBe(false);
  });

  it('нова версія вже чекала до відкриття сторінки', () => {
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker('installed');
    const updates = new AppUpdates(vi.fn());
    updates.watch(
      registration as unknown as ServiceWorkerRegistration,
      new FakeContainer(new FakeWorker('activated')) as unknown as ServiceWorkerContainer,
    );
    expect(updates.getState().available).toBe(true);
  });

  it('«Оновити»: новий service worker активується, і сторінка перезавантажується один раз', () => {
    const { registration, container, reload, updates } = setup();
    const worker = registration.found();
    worker.become('installed');
    updates.apply();
    expect(worker.messages).toEqual([{ type: 'skipWaiting' }]);
    expect(reload).not.toHaveBeenCalled();
    container.takeOver(worker);
    container.takeOver(worker);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('без нової версії service worker «Оновити» просто перезавантажує сторінку', () => {
    const { reload, updates } = setup();
    updates.apply();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('зміна service worker без запиту гравця сторінку не перезавантажує', () => {
    const { container, reload } = setup();
    container.takeOver(new FakeWorker('activated'));
    expect(reload).not.toHaveBeenCalled();
  });

  it('коли гравець повертається на вкладку, перевіряє, чи не вийшла нова версія', () => {
    const { registration } = setup();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(registration.update).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('повідомлення про нову версію', () => {
  function renderApp() {
    const connection = new FakeConnection();
    const client = new PokerClient(connection);
    const { registration, container, reload, updates } = setup();
    render(<App client={client} updates={updates} />);
    return { connection, registration, container, reload, updates, user: userEvent.setup() };
  }

  it('показує «Доступна нова версія» з кнопкою «Оновити»', async () => {
    const { registration, container, reload, user } = renderApp();
    expect(screen.queryByText(/Доступна нова версія/)).not.toBeInTheDocument();
    const worker = registration.found();
    act(() => worker.become('installed'));
    expect(screen.getByText(/Доступна нова версія гри/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Оновити' }));
    expect(worker.messages).toEqual([{ type: 'skipWaiting' }]);
    act(() => container.takeOver(worker));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('несумісна версія протоколу: одне повідомлення, «Оновити» активує новий service worker', async () => {
    const { connection, registration, container, reload, user } = renderApp();
    const worker = registration.found();
    act(() => worker.become('installed'));
    act(() => connection.pushStatus('outdated'));
    expect(screen.queryByText(/Доступна нова версія/)).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Вийшла нова версія гри');
    await user.click(screen.getByRole('button', { name: 'Оновити' }));
    expect(worker.messages).toEqual([{ type: 'skipWaiting' }]);
    act(() => container.takeOver(worker));
    expect(reload).toHaveBeenCalledOnce();
  });
});
