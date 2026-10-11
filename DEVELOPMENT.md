# Developing Downbeat

How to build, install for development, and find your way around the code.
For using the plugin, see [README.md](README.md) and the guide.

## Build from source

```sh
git clone https://github.com/ominousopera/Downbeat.git
cd Downbeat
scripts/fetch-node-runtime.sh        # Node.js for macOS and Windows, SHA-256 checked
scripts/fetch-beatthis-runtime.sh    # onnxruntime-web by its committed lockfile
scripts/build-zxp.sh                 # needs Adobe's ZXPSignCmd, see below
```

The checks that run before a build and the code layout are below.

## Dev install (symlink) — the only case that needs PlayerDebugMode

For iterating on code, where every save should show up on the next panel
reload without a rebuild:

```sh
scripts/dev-install.sh
```

It symlinks this folder into Premiere's extensions folder and sets
`PlayerDebugMode=1` for CSXS 9-12 (idempotent). A source folder has no
signature, and `PlayerDebugMode` is what lets CEP load an unsigned one. It
does that for every unsigned extension on the machine, so don't leave it
on for a shared computer. `scripts/dev-uninstall.sh` removes the symlink
only, never a real directory.

**Don't have both at once.** A ZXP installer's Remove only removes the
copy it installed; a symlink keeps loading regardless. `build-zxp.sh`
refuses to run while the dev symlink exists.

Attach Chrome DevTools: create a file named `.debug` in the extension
folder (see Adobe's CEP documentation for the format; it is a
developer-local file and is not in the repository), and with the panel
open go to `http://localhost:<port>`.

## Build a release

```sh
scripts/dev-uninstall.sh   # only if the dev symlink is currently active
scripts/build-zxp.sh
```

Bump `ExtensionBundleVersion` in `CSXS/manifest.xml` first. The script refuses
to overwrite an existing version, because some installers silently skip a
reinstall with an unchanged version string. Output goes to `zxp-build/` next
to the repository (the script creates it): `Downbeat-<version>-mac.zxp` and
`Downbeat-<version>-win.zxp`, each with only its own platform's Node.js.

The build scripts are `sh` and run on macOS; the Windows package is built
there too (it only swaps in the Windows Node.js). The checks use `git ls-files`,
so work in a git clone, not an unzipped archive.

From a fresh clone, once:

```sh
scripts/fetch-node-runtime.sh       # Node.js 24.18.0 for macOS (arm64, x64) and Windows x64, SHA-256 checked
scripts/fetch-beatthis-runtime.sh   # onnxruntime-web 1.27.0 by its committed lockfile (models/ is in the repository)
```

Signing needs Adobe's `ZXPSignCmd` (Adobe's CEP resources, or the
`vite-cep-plugin` npm package): put its path in `scripts/build.local.sh`
as `ZXPSIGNCMD="..."` (not in git), or in the `ZXPSIGNCMD` environment
variable, or on the PATH. The first build makes a self-signed certificate
in `zxp-build/` with a random password kept next to it.

Before packaging, the script refuses to build if any of these fail
(a pre-build gate):

- manifest is not well-formed XML;
- `index.html` points at a missing file;
- a script looks up an element id that does not exist
  (`scripts/check-dom-ids.py`);
- any panel script, worker or ExtendScript file does not parse;
- the panel does not finish booting, or Delete my data touches anything
  that is not its own, or booting writes into the extension folder
  (`scripts/test-panel-boot.js`);
- the delete code can be tricked into touching anything outside its own
  files (`scripts/test-delete-safety.js`);
- the host scripts misbehave on mock hosts (`scripts/host-mocks.js`):
  After Effects functions, Library insert, and placing / clearing markers
  touching anything but Downbeat's own (`test-host-ae.js`,
  `test-host-insert.js`, `test-marker-replace.js`);
- the pitch calculator and Beat This!'s doubled-beat merge drift
  (`test-pitch.js`, `test-beat-merge.js`);
- the real workers under the bundled Node fail end to end: worker smoke,
  a real-track Analyze through the panel, and the Library (scan, search,
  insert, decode queue, S-KEY music keys, the SFX pitch check, file-name
  tags, the WAV/AIFF reader) - `test-worker-smoke.js`,
  `test-analyze-pipeline.js`, `test-library-*.js`, `test-sfx-pitch-gate.js`,
  `test-name-tags.js`, `test-wav-excerpt.js`. The ones that need ffmpeg or
  the local test tracks skip without them;
- the staged package contains symlinks or a `data/` folder.

The full self-test in mock Premiere and After Effects
(`scripts/test-self-test.js`) is slow; run it by hand after
touching marker placement, cutting or the host scripts.

After signing, it verifies the signature of each finished `.zxp` and of
an unpacked copy with `ZXPSignCmd -verify`, and compares the package with
the staged files byte for byte. Release packages are built with
`STRIP_COMMENTS=1`, which removes the code comments
(`scripts/strip-comments.js`, checked token by token by a second parser,
then the main tests run again on that copy); the full source, with its
comments, is this repository.

The bundled runtimes are fetched once, manually, by the two scripts above
(pinned versions, hash-checked), never automatically. The plugin itself
goes online only for a requested release check or optional periodic
update notices. Analysis and Library stay offline.

## Uninstall

A ZXP install: remove it in the ZXP installer, or run
`scripts/uninstall-zxp.sh`. That script checks the folder really is
`com.downbeat.pro` before removing anything. Neither of them touches
Documents/Downbeat; use Delete my data in the panel first if the data
should go too.

## How the code is organized

| Where | What |
|---|---|
| `CSXS/manifest.xml` | the CEP manifest (CSXS 11, so Premiere Pro and After Effects 2021+; Node on) |
| `index.html`, `css/style.css` | the panel's markup and its one stylesheet |
| `js/main.js` | starts the panel; Analyze and Key tabs; selection poll; shared state |
| `js/bridge.js` | calls into the host scripts and runs the analysis workers |
| `js/library-tab.js` | the Library tab: folders, scan, search, list, preview pane, In key |
| `js/settings-panel.js` | settings, diagnostics, Guide / licenses viewer, Delete my data |
| `js/beat-preview.js` | the Analyze tab's waveform player with the downbeat click |
| `js/self-test.js` | the full self-test used by `scripts/test-self-test.js` (hidden in the UI) |
| `js/analyze.js`, `js/cuesheet.js`, `js/place.js` | analysis results -> marker times -> placement |
| `js/analysis-cache.js` | reuse of identical tempo passes on the same decoded audio |
| `js/metronome.js`, `js/audio-output.js` | the metronome track; where finished audio is written, never over an existing file |
| `js/update-check.js` | the opt-in release check, the panel's only network code |
| `js/sound-library.js`, `js/sfx-search.js`, `js/ucs-data.js` | Music / SFX library data and search (UCS) |
| `js/lib-preview.js`, `js/audio.js` | the preview player, pitch / reverse / fades, decoding |
| `js/camelot.js`, `js/pitch.js`, `js/key-combine.js`, `js/wheel.js` | keys, Camelot wheel, pitch calculator |
| `js/i18n.js`, `js/tour.js`, `js/ui-select.js` | languages, the first-run tour, drawn dropdowns |
| `js/persistence.js`, `js/library.js` | saved data, the analyzed-clips list |
| `jsx/host.jsx`, `jsx/host-ae.jsx` | ExtendScript run by Premiere Pro / After Effects: markers, inserts, fades |
| `worker/` | Node processes: essentia (tempo, beats, key), Beat This!, S-KEY, WAV / AIFF reader |
| `models/` | the ONNX models (Beat This!, its mel spectrogram, S-KEY) |
| `scripts/` | build, fetch, checks (`check-code.js`, `check-dom-ids.py`) and tests (`test-*.js`) |

Every script opens with a comment saying what it is for. Formatting
follows `.editorconfig` (2 spaces, 4 in the host scripts, LF, no trailing
spaces), and `scripts/check-code.js` checks it before every build.
