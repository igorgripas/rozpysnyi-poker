import { describe, expect, it } from 'vitest';
import { serverUrl } from '../src/net/serverUrl';

describe('адреса сервера', () => {
  it('за замовчуванням — той самий хост або VITE_SERVER_URL', () => {
    expect(serverUrl('', { dev: false, configured: undefined })).toBeUndefined();
    expect(serverUrl('', { dev: false, configured: '' })).toBeUndefined();
    expect(serverUrl('', { dev: false, configured: 'https://api.example' })).toBe(
      'https://api.example',
    );
  });

  it('у режимі розробки e2e-тести задають сервер параметром ?server=', () => {
    expect(serverUrl('?server=http://localhost:4100', { dev: true, configured: undefined })).toBe(
      'http://localhost:4100',
    );
  });

  it('у зібраному застосунку параметр ?server= ігнорується', () => {
    expect(
      serverUrl('?server=https://evil.example', { dev: false, configured: undefined }),
    ).toBeUndefined();
  });
});
