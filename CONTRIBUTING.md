# Contributing

Issues and pull requests are welcome. Report false positives and false negatives with the
smallest repository history that reproduces them.

```bash
npm ci
npm run all            # brand check, typecheck, tests, build
npm run lint:actions   # actionlint on the example workflows (needs actionlint)
```

- Commit the rebuilt `dist/` bundles with your source change; CI fails if they differ.
- Every brand string lives in `brand.json`. After editing it, run `npm run brand:sync`.
- Tests never touch the network: global `fetch` throws unless a test mocks it.
- Contributions are licensed under the MIT licence of this repository.
