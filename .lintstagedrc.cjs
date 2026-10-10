module.exports = {
  // Project builds use TS build mode and must not receive an appended list of source files.
  'web/src/**/*.{ts,tsx}': () => ['pnpm typecheck', 'pnpm test'],
  'web/**/*.json': () => ['pnpm test'],
}
