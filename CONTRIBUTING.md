# Contributing to LuneDB

Thanks for taking the time. LuneDB is a small project — issues, bug reports and
pull requests are all welcome.

## Getting set up

You need Node.js 20+, a stable Rust toolchain and the platform build tools
listed under [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
git clone https://github.com/alibekashirali/lunedb.git
cd lunedb
npm install
npm run tauri:dev
```

The first Rust build takes a few minutes; later ones are incremental.

To try the AI features you also need [Ollama](https://ollama.com) running
locally with at least one model pulled (`ollama pull llama3.2`).

## Before opening a pull request

Run what CI runs:

```bash
npm run lint                                  # ESLint
npm test                                      # frontend unit tests
npm run build                                 # Next.js static export
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

All five must pass. CI runs the same commands on Linux for every pull request.

## Code conventions

- **TypeScript**: functional components, `@/` path alias for imports, Tailwind
  for styling, Zustand for shared state. Keep component files under ~600 lines —
  split a panel into pieces before it grows past that.
- **Rust**: `#[tauri::command]` functions return `Result<T, String>` with an
  error message a user can act on. Keep the database, keychain, SSH and Ollama
  concerns in their own modules.
- **Pure logic goes in `src/lib/`** rather than inside a component, so it can be
  unit tested — see [`src/lib/sql-statements.ts`](src/lib/sql-statements.ts) and
  its tests in [`tests/`](tests/).
- The codebase is not `rustfmt`-formatted wholesale; match the style of the file
  you are editing.

## Tests

- Frontend: [Vitest](https://vitest.dev), files in `tests/*.test.ts`, run with
  `npm test`.
- Rust: `#[cfg(test)]` modules next to the code, run with `cargo test`.

Logic that can be tested without a live database or a running app should come
with tests. Anything that needs a real PostgreSQL server is exercised by hand.

## Reporting bugs

Open an issue with your OS, LuneDB version, PostgreSQL version and the steps to
reproduce. If a connection fails, the exact error text from the dialog helps a
lot.

For anything security-sensitive, follow [SECURITY.md](SECURITY.md) instead of
opening a public issue.

## Scope

LuneDB is deliberately local-first: no accounts, no cloud sync, no telemetry.
Features that would send user data anywhere other than the user's own database
and their own Ollama instance are out of scope.
