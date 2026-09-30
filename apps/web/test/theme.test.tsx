import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, ThemeToggle, THEME_STORAGE_KEY } from '../src/ui/theme';

function mockSystemDark(dark: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: dark && query.includes('dark'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe('теми', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.theme;
  });

  it('за замовчуванням бере тему системи', () => {
    mockSystemDark(true);
    renderToggle();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('перемикач змінює тему й запамʼятовує вибір', async () => {
    mockSystemDark(false);
    renderToggle();
    expect(document.documentElement.dataset.theme).toBe('light');
    await userEvent.click(screen.getByRole('button', { name: 'Темна тема' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(screen.getByRole('button', { name: 'Світла тема' })).toBeInTheDocument();
  });

  it('збережений вибір має пріоритет над темою системи', () => {
    mockSystemDark(true);
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    renderToggle();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
