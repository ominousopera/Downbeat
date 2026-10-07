# Contributing

Downbeat is a small, free CEP panel for Premiere Pro and After Effects.
Bug reports, translations and focused pull requests are welcome.

**Reporting a bug:** open an issue with the Downbeat version, host app and
version, operating system, what you did and what happened. **Settings >
Diagnostics > Copy log** puts the log on the clipboard; please paste it.

**Before a pull request**

- Read `README.md` ("How the code is organized") and keep to the existing
  style: `.editorconfig`, a header comment at the top of every script, plain
  scripts (no bundler, no build step for the panel itself).
- Run `node scripts/check-code.js`, `python3 scripts/check-dom-ids.py` and the
  tests you touched (`node scripts/test-*.js`; the host scripts are tested on
  mock Premiere and After Effects in `scripts/host-mocks.js`). Tests that
  need real tracks or ffmpeg skip when those are missing.
- Code, comments and docs are in English. User-facing text goes through
  `js/i18n.js` in all three languages (English first).
- The panel must stay offline: no network calls, no telemetry. The one
  exception is the optional, off-by-default update notice in
  `js/update-check.js`, which reads this project's latest release number and,
  when the user presses the button, downloads that release's package and checks
  it against the published checksum before opening it. Nothing writes into the extension folder (it would break the
  signature); saved data lives in `Documents/Downbeat`.
- Never change or delete a user's audio file; sounds are inserted as the file
  itself, with pitch and reverse set on the clip.
- Third-party code is pinned by hand and recorded with its hash in
  `NOTICE.md`; do not add auto-updating dependencies.

By contributing you agree that your contribution is licensed under the
AGPL-3.0, like the rest of the project.
