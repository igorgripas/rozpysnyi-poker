import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { PokerClient } from '../src/net/client';
import { FakeConnection } from './support/fakeConnection';

function renderApp() {
  return render(<App client={new PokerClient(new FakeConnection())} />);
}

describe('меню налаштувань у шапці', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'vibrate', { value: () => true, configurable: true });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'vibrate');
  });

  it('у шапці лише назва, звʼязок і ⚙; вібрація, звук і тема — за ⚙', async () => {
    renderApp();
    const header = screen.getByRole('banner');
    const menu = screen.getByRole('button', { name: 'Налаштування' });
    expect(header).toContainElement(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Вібрація на свій хід' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Темна тема' })).toBeNull();

    await userEvent.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('group', { name: 'Налаштування' });
    expect(panel).toContainElement(screen.getByRole('button', { name: 'Вібрація на свій хід' }));
    expect(panel).toContainElement(screen.getByRole('button', { name: /^(Темна|Світла) тема$/ }));
    // Підписи видно текстом, а не лише значками.
    expect(panel).toHaveTextContent('Вібрація на свій хід');
  });

  it('перемикач у меню не закриває його; Escape закриває й повертає фокус на ⚙', async () => {
    renderApp();
    const menu = screen.getByRole('button', { name: 'Налаштування' });
    await userEvent.click(menu);
    await userEvent.click(screen.getByRole('button', { name: 'Вібрація на свій хід' }));
    expect(menu).toHaveAttribute('aria-expanded', 'true');

    await userEvent.keyboard('{Escape}');
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(menu).toHaveFocus();
    expect(screen.queryByRole('group', { name: 'Налаштування' })).toBeNull();
  });

  it('клік поза меню і повторний клік на ⚙ закривають його', async () => {
    renderApp();
    const menu = screen.getByRole('button', { name: 'Налаштування' });
    await userEvent.click(menu);
    await userEvent.click(screen.getByRole('main'));
    expect(menu).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(menu);
    await userEvent.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'false');
  });
});
