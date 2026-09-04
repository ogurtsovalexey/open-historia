/** Fail loudly if a future dependency tries the ambient web API. */
export function installOfflineGuards() {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: false,
    writable: false,
    value: async () => { throw new Error('network access is forbidden in offline scenario tooling'); },
  });
}
