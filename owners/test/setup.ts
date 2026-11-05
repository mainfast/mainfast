// No test may reach the network. The Action's GitHub client falls back to the global fetch, so
// replace it with one that throws; tests that need GitHub stub it (vi.stubGlobal) or inject a mock.
import { beforeEach, vi } from 'vitest';

export const networkGuard = async (url: unknown): Promise<never> => {
  throw new Error(`test tried to reach the network: ${String(url)} (mock it with @mainfast/shared/mockfetch)`);
};

globalThis.fetch = networkGuard as unknown as typeof fetch;
beforeEach(() => {
  // vi.unstubAllGlobals() in a previous test restores this guard, not the real fetch
  if (globalThis.fetch !== (networkGuard as unknown)) vi.unstubAllGlobals();
});
