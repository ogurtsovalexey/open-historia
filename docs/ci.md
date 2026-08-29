# Continuous Integration

This repository uses GitHub Actions to validate every push and pull request to the `main` branch.

## Workflow

The CI workflow (`.github/workflows/ci.yml`) runs on Ubuntu with Node.js 22 and executes a single aggregate validation:

1. **Install dependencies** (`npm ci`)
2. **Run all checks** (`npm run ci`) — runs lint, tests, production build, and agent‑script tests in sequence.

The workflow captures the size of the built bundles (`dist`, `dist‑web`) and any warnings reported during the build.

## Aggregate command

You can run the same validation locally with:

```bash
npm run ci
```

This command runs the four steps sequentially and is what the CI workflow uses.

## Production build

`npm run build` creates the Vite production client bundle (the same code that ships in the Electron app). The web‑only variant (`dist‑web`) is not built by default; the CI workflow reports its size only if it exists.

## Baseline tracking

The CI job captures the size of the `dist` and `dist‑web` directories after each build and reports any warnings in the GitHub Actions step summary. This provides a simple size baseline to detect unexpected growth.

## Missing validators

Currently there is no dedicated scenario‑ or schema‑validation command wired into CI. Scenario spec validation is performed by the `scripts/presets/build‑preset.mjs` tool during preset generation, but no standalone “validate all specs” script exists. Schema validation is embedded in runtime gameplay (`validateGameplayPayload`) and is exercised by the unit tests.
