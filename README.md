# ui-components

A collection of UI components, each one a standalone package, plus a playground app to try them in.

| Package                                              | What it is                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [`@ui-components/ascii-image`](packages/ascii-image) | An image as coloured ASCII characters: transitions, easing, flicker, underlay, mouse reveal |

## Layout

```
packages/        one folder per component, each its own npm package (TypeScript source, tests, README)
apps/playground  Vite + React app that uses the packages through the workspace link
```

The playground imports `@ui-components/ascii-image` the same way any consumer would. A change in `packages/` shows up in the playground immediately, with no build step in between.

## Set-up

Node 22 or newer (`.nvmrc`), npm workspaces.

```bash
npm install
npm run dev          # playground on http://localhost:5173
```

| Command             | What it does                                         |
| ------------------- | ---------------------------------------------------- |
| `npm run dev`       | Playground dev server                                |
| `npm run build`     | Playground production build (`apps/playground/dist`) |
| `npm test`          | Every package's unit tests (Vitest)                  |
| `npm run typecheck` | `tsc` in every workspace                             |
| `npm run format`    | Prettier, writing                                    |
| `npm run check`     | What CI runs: format check, typecheck, tests, build  |

## Adding a component

1. Create `packages/<name>/` with a `package.json` named `@ui-components/<name>`. Copy the shape of `packages/ascii-image`: `exports` pointing at `src/index.ts`, React as a peer dependency, and `test` and `typecheck` scripts.
2. Add a `tsconfig.json` extending `../../tsconfig.base.json`.
3. Add `"@ui-components/<name>": "*"` to `apps/playground/package.json`, then run `npm install` to link it.
4. Give it a section in the playground.

## Notes

`.npmrc` sets `legacy-peer-deps`. This works around an npm 10 crash ("Cannot read properties of null (reading 'edgesOut')") when it resolves Vitest's optional peers.
