import { describe, expect, it } from 'vitest';
import { ENGINE_LOG_VERSION } from '../src/index.js';

describe('engine', () => {
  it('exposes log version', () => {
    expect(ENGINE_LOG_VERSION).toBe(1);
  });
});
