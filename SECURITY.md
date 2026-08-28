# Security Policy

## Supported versions

LuneDB is pre-1.0. Only the latest release receives fixes.

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Report it privately through GitHub Security Advisories:
[**Report a vulnerability**](https://github.com/alibekashirali/lunedb/security/advisories/new).

Useful details: what an attacker can do, the steps to reproduce, and the
affected version and platform. You will get a first response within a week.
This is a hobby-scale project — there is no bounty programme.

## What LuneDB does with your secrets

- **Database passwords and SSH passwords/key passphrases** are stored in the OS
  keychain — Keychain on macOS, Credential Manager on Windows, Secret Service on
  Linux. They are never written to the app's SQLite file.
- **Private SSH keys are never read into the app's storage.** Only the *path* to
  the key file is saved in SQLite; the key itself stays where you put it and is
  read by libssh2 at connection time.
- **Connection settings, wiki pages and query history** live in a local SQLite
  file in the app data directory, unencrypted. Anyone with access to your user
  account can read them.
- **No telemetry, no crash reporting, no network calls** other than to your
  database, your SSH host and your local Ollama instance at `localhost:11434`.

## Transport security

- **SSH host keys** are checked against `~/.ssh/known_hosts` using a
  trust-on-first-use policy, the same as `ssh -o StrictHostKeyChecking=accept-new`:
  a host seen for the first time is recorded and accepted, and a host whose key
  later changes is refused with an error. LuneDB appends to `known_hosts`; it
  never rewrites entries it did not add.
- **PostgreSQL TLS** follows the SSL mode you pick per connection. The default,
  `prefer`, uses TLS when the server offers it but falls back to an unencrypted
  connection otherwise — pick `require`, `verify-ca` or `verify-full` when you
  connect over an untrusted network.

## Known limitations

- Release binaries are **not code-signed**. Verify what you download, or build
  from source.
- The local SQLite database is not encrypted at rest.
- There is no protection against a malicious local process reading LuneDB's
  memory or its SQLite file.
