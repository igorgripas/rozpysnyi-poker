import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { PokerClient } from '../src/net/client';
import { FakeConnection } from './support/fakeConnection';

describe('каркас застосунку', () => {
  it('показує заголовок українською і перемикач теми', async () => {
    render(<App client={new PokerClient(new FakeConnection())} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Розписний покер' })).toBeInTheDocument();
    // Перемикач теми — у меню налаштувань у шапці.
    await userEvent.click(screen.getByRole('button', { name: 'Налаштування' }));
    expect(screen.getByRole('banner')).toContainElement(
      screen.getByRole('button', { name: /тема/ }),
    );
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
