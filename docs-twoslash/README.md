# docs-twoslash

A thin re-export of [`fumadocs-twoslash`](https://www.npmjs.com/package/fumadocs-twoslash)
for the docs site. It exists purely to keep that dependency's TypeScript
requirement out of the rest of the workspace.

## Why

`twoslash` (used by `fumadocs-twoslash` to type-check the code samples in our
MDX) needs the classic TypeScript JavaScript API — `ts.sys`,
`createLanguageService`, and friends. TypeScript 7 does not ship one: its
`typescript` package only exposes `{ version }` plus a native `tsc` binary, so
importing `typescript` inside twoslash yields `undefined` for `ts.sys` and the
docs build fails while highlighting the first `twoslash` code fence. The rest of
the workspace is on TypeScript 7, so twoslash needs a TypeScript 5 next to it.

Declaring `typescript@^5.9.3` in `docs` itself would work for twoslash, but it
breaks the test suite. `vitest` (via `@vitest/mocker` -> optional `msw` peer ->
optional `typescript` peer) puts the resolved TypeScript version into its pnpm
peer-resolution key, so a second TypeScript version in any importer splits
`vitest` into multiple physical instances. `vp run test` starts the runner from
the workspace root while each test file resolves `vite-plus/test` relative to
itself, so a package that landed on the other instance gets a second
`SnapshotClient` and every `toMatchFileSnapshot` fails with "The snapshot state
for '...' is not found". (`pnpm-workspace.yaml` pins `@types/node` and `jsdom`
for the same reason.)

Moving `fumadocs-twoslash` into its own workspace package solves both: the
TypeScript 5 requirement lives in an importer whose dependency graph contains no
`vitest`, so twoslash gets its classic API and the workspace keeps a single
`vitest` instance.

## Removing this package

Once `twoslash` supports the TypeScript 7 API (per the TypeScript 7 release
notes, an API is expected in 7.1), delete this package and depend on
`fumadocs-twoslash` from `docs` directly.
