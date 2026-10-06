# Third-party components

Downbeat itself is free software, released under the **GNU Affero General
Public License v3.0** (full text in `LICENSE`), © 2026 Nikita Kolesov. The
third-party components below keep their own licenses, listed with each
one: essentia.js is AGPL-3.0 itself; the rest are MIT, ISC, BSD, Apache-2.0
or public domain, except `js/CSInterface.js`, which is under Adobe's own CEP
terms. Downbeat is an independent project, not made, endorsed or sponsored
by Adobe.

Update policy: components are pinned by hand and never auto-updated.
Re-verify (diff and rehash) before any change.

## js/CSInterface.js

- Source: `github.com/Adobe-CEP/CEP-Resources`, `CEP_12.x/CSInterface.js`
  (v12.0.0, © 2020 Adobe)
- Size: 42759 bytes
- sha256: `3c45400984772b88cdf4604b4763a29219f8071fdedb9a1fa19d997349003783`
- License: Adobe's, not AGPL (the AGPL covers Downbeat's own files only).
  The file's header says Adobe permits use, modification and distribution
  "in accordance with the terms of the Adobe license agreement accompanying
  it"; the agreement is published in the same repository (License folder).
  The header is reproduced under "License texts" below.

## jsx/json2.js

- Source: `github.com/douglascrockford/JSON-js`, `json2.js`
- Size: 18876 bytes
- sha256: `86df14b56572e68a7e10b18e71804cb78c6890a7d6e534324822c23d12e858a2`
- License: public domain, declared in the file's own header ("Public
  Domain. NO WARRANTY EXPRESSED OR IMPLIED.").
- Why: ExtendScript is an ES3 engine without native `JSON.parse` /
  `JSON.stringify`; the host scripts return structured data to the panel.

## js/lib/essentia-wasm.web.js, essentia-wasm.web.wasm, essentia.js-core.js

- Source: the npm package `essentia.js`, version `0.1.3`. Upstream:
  `github.com/MTG/essentia.js` (Music Technology Group, UPF Barcelona).
- sha256 of the three files:
  ```
  essentia-wasm.web.js   ea8891410df550d2b5a0ae53e64809516196f59607385b02475d79cd5a7df89f
  essentia-wasm.web.wasm 44cb2434da19a06f1e47decd9305699cfcd4a2c1641b4235a3a89183da62fd62
  essentia.js-core.js    64c87394ce8c7c9beed0af5c1b163121828e9852ff75a31fbf82a66b505e2e1d
  ```
- License: **AGPL-3.0**, the same as Downbeat.
- Corresponding Source: `github.com/MTG/essentia.js` at the `v0.1.3`
  release (commit f46c91c08bdf263d5f3d575ab8fb0f9b81695acf), plus the
  essentia C++ core it compiles (`github.com/MTG/essentia`, AGPL-3.0),
  commit `e3b6cfeaed4ea92cd7377be2a0980aa91b08b378`. Archives of exactly
  these two source trees are attached to each Downbeat release on GitHub.
  Their SHA-256: `essentia.js-v0.1.3-f46c91c.tar.gz`
  `890cf8fa727a3a326de20e7fcbd76b573d4de96e3cc5d4d578c3359769aa94b1`,
  `essentia-e3b6cfe.tar.gz`
  `6a8f17e668ff9af0bc8f1d4dd8b2a97a1deb10899b982351e6ab3e621c289fbe`.
- How it is used: the UMD build runs in a separate Node subprocess
  (`worker/analyze-worker.js`, through `worker/essentia-node-harness.js`),
  not in the panel itself.

## runtime/node/{darwin-arm64,darwin-x64,win-x64}/node[.exe]

(Not in the repository; created by `scripts/fetch-node-runtime.sh`.)

- Source: the official `nodejs.org/dist/` builds of v24.18.0, fetched by
  `scripts/fetch-node-runtime.sh` (hashes hardcoded in that script; compare
  with `https://nodejs.org/dist/v24.18.0/SHASUMS256.txt` before updating it).
- sha256 of the official archives (only the bare executable is extracted):
  - `node-v24.18.0-darwin-arm64.tar.gz`: `e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1`
  - `node-v24.18.0-darwin-x64.tar.gz`: `dfd0dbd3e721503434df7b7205e719f61b3a3a31b2bcf9729b8b91fea240f080`
  - `node-v24.18.0-win-x64.zip`: `0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821`
- License: MIT (Node.js itself; it bundles other permissive components such
  as V8, libuv and OpenSSL, listed in Node's own `LICENSE`).
- Why bundled: the panel starts the analysis workers as real Node
  processes, so no Node.js has to be installed on the user's computer.
  Each release package carries only its own platform's executable (macOS
  arm64 and x64 together, or Windows x64).
- The macOS executables are signed by the Node.js Foundation (Apple
  Developer ID) and keep that signature inside the package.

## runtime/onnxruntime-web/node_modules/{onnxruntime-web,onnxruntime-common,protobufjs,flatbuffers,@protobufjs,long,platform,guid-typescript}/

(Not in the repository; created by `scripts/fetch-beatthis-runtime.sh`.)

- Source: the npm package `onnxruntime-web`, version `1.27.0`. Upstream:
  `github.com/microsoft/onnxruntime`. The transitive dependencies resolve
  through the committed `package.json` / `package-lock.json` in
  `scripts/beatthis-runtime-src/`; that lockfile, with its integrity
  hashes, is the source of truth for every exact version.
- Fetched by `scripts/fetch-beatthis-runtime.sh` (`npm ci`). Of
  `onnxruntime-web/dist/` only four files are kept: `ort.node.min.js`,
  `ort.node.min.js.map`, `ort-wasm-simd-threaded.wasm` and
  `ort-wasm-simd-threaded.mjs`.
- WASM CPU backend, not a native addon: one binary works the same on every
  platform and architecture.
- Licenses: onnxruntime-web and onnxruntime-common MIT (Microsoft);
  protobufjs BSD-3-Clause; flatbuffers and long Apache-2.0; platform MIT;
  guid-typescript ISC. The packages that carry their own `LICENSE` file keep
  it; the rest are reproduced under "License texts".
- Why bundled: `worker/beatthis-worker.js` runs the Beat This! model through
  this runtime, entirely offline.
- Size: about 22 MB, mostly the one WASM binary.

## models/skey.onnx, worker/skey-core.js, worker/skey-worker.js (S-KEY key detector)

- What: S-KEY, "Self-supervised Learning of Major and Minor Keys from Audio"
  (Deezer Research, ICASSP 2025): a small network of a VQT front end and
  ChromaNet. Used as the third key opinion for music (`js/key-combine.js`) and
  for music keys in the Library scan (`worker/skey-core.js`).
- Source: `github.com/deezer/skey` at commit
  918b83d273568d5041569bb8068843d19a335726.
- Checkpoint `skey/models/skey.pt`, sha256
  `78dfd0ad4fa9434bf7cec70a25934b7c575bda9c80e994700140770ad3a5ead4`.
- Shipped file: `models/skey.onnx`, sha256
  `83fcf7ee14388e33bb79462439c805cbef853c4afca3ae70e847e5c2aba4e426`,
  exported with `scripts/skey-export/export_skey_onnx.py`, which checks the
  exported graph against the upstream PyTorch one (max abs difference
  < 1e-4, same argmax).
- License: **MIT** (Copyright (c) Deezer), code and published model alike.
  Only the export needs nnAudio 0.3.3 (MIT); the plugin runs just the ONNX
  file, through the onnxruntime-web listed above.

## models/mel_spectrogram.onnx, models/beat_this_own_export.onnx (Beat This!)

- Source: `CPJKU/beat_this` (Institute of Computational Perception, JKU
  Linz) - `github.com/CPJKU/beat_this`. The two files are an ONNX export of
  that project's published model checkpoint (upstream does not distribute
  ONNX files); `beat_this_own_export.onnx` is the int8-quantized export
  (dynamic quantization, QInt8 weights).
- License: **MIT**, Copyright (c) 2024 Institute of Computational
  Perception, JKU Linz, Austria; the upstream README says the code and the
  published model weights are released under the MIT license. A quantized
  derivative of an MIT-licensed model stays MIT.
- sha256:
  ```
  mel_spectrogram.onnx                fdd59e65c515331308e4c8841edf99972deca646bdf6197744c2a5b7755e3de9
  beat_this_own_export.onnx (int8)    0869fcdfa66fcdecb7af5d0022d3c3fadc55c07f69f16febdcac681531676751
  ```
  `scripts/fetch-beatthis-runtime.sh` verifies both against these hashes.
- Size: about 22.9 MB (`beat_this_own_export.onnx`) and 264 KB
  (`mel_spectrogram.onnx`), one copy for all platforms.
- Why bundled: the model files that `worker/beatthis-worker.js` runs
  through the onnxruntime-web runtime above. They give the beat and
  downbeat positions; the tempo (BPM) comes from essentia, which also
  helps pick the beat that counts as the "1".

## js/ucs-data.js (Universal Category System list, for the Library search)

- What: the Universal Category System (UCS), a standard category list for
  sound effects: 753 categories such as DESIGNED / WHOOSH, each with a CatID
  ("DSGNWhsh") that UCS-named files start with, English synonyms and
  translations. `js/sfx-search.js` uses it so that a UCS-named file is
  found by its category too, and synonyms widen a query ("swoosh" also
  finds WHOOSH files; the Russian and Spanish names find the English ones).
- Source: `universalcategorysystem.com` (its resources page and the
  official folder it links to), version **8.2.1**.
- License: **public domain** (the UCS is a public domain initiative, per the
  official site).
- Input of the build: `_categorylist.csv` from the official download,
  sha256
  `2bda398cd3d524201cb67d1cb09a21cdb00e52ff2ae5e6c46f1c47461735c620`.
- Shipped file: `js/ucs-data.js`, generated by `scripts/build-ucs-data.js`,
  which refuses a CSV with any other sha256. It keeps per category: CatID,
  category, subcategory, English synonyms, and the Russian and Spanish
  names and synonyms. It is plain data (one array, no code), about 324 KB,
  sha256 `c5bfc2443a235ed41b5873851a9fcf47febb4edab7790af37f184222aba133bd`.

## scripts/vendor/ (acorn and esprima)

- What: acorn 8.15.0 (`acorn-8.15.0.js`, MIT) and esprima 4.0.1
  (`esprima-4.0.1.js`, BSD-2-Clause), JavaScript parsers used only by the
  build checks (`scripts/check-code.js`, `scripts/strip-comments.js`).
  They are build-time tools and are never shipped in the package.
- Their license files sit beside them (`acorn-LICENSE`, `esprima-LICENSE`);
  hashes are in `scripts/vendor/README.md`.

## License texts

The packages under `runtime/onnxruntime-web/node_modules/` named below
that carry their own `LICENSE` file (`protobufjs`, `@protobufjs/*`,
`flatbuffers`, `long`, `platform`) keep it next to their code. The texts
for the components that do not are reproduced here, so every copy of
Downbeat carries them.

### onnxruntime-web 1.27.0 and onnxruntime-common 1.27.0 (MIT)

```
MIT License

Copyright (c) Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Beat This! models (MIT)

```
MIT License

Copyright (c) 2024 Institute of Computational Perception, JKU Linz, Austria

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### S-KEY (MIT)

```
MIT License

Copyright (c) 2019-present, Deezer SA.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Node.js v24.18.0 (MIT)

Only the bare `node` / `node.exe` executable is bundled. Node.js's own
license, as published in its `LICENSE` file:

```
Node.js is licensed for use as follows:

"""
Copyright Node.js contributors. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""
```

The executable also contains third-party components (V8, libuv, OpenSSL,
ICU, zlib, and others) under their own permissive licenses. Their notices
are listed in full in the `LICENSE` file at the root of the official
release: `https://github.com/nodejs/node/blob/v24.18.0/LICENSE` (the same
file ships inside every `node-v24.18.0-*` archive from nodejs.org).

### guid-typescript 1.0.9 (ISC)

```
ISC License

Copyright (c) the guid-typescript authors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### essentia.js 0.1.3 (AGPL-3.0)

The AGPL-3.0 text is in `LICENSE`. The compiled build ships as
`js/lib/essentia-wasm.web.*` and `js/lib/essentia.js-core.js`; the
Corresponding Source is given under the essentia.js entry above.

### js/CSInterface.js (Adobe)

```
ADOBE SYSTEMS INCORPORATED
Copyright 2020 Adobe Systems Incorporated
All Rights Reserved.

NOTICE:  Adobe permits you to use, modify, and distribute this file in
accordance with the terms of the Adobe license agreement accompanying it.
If you have received this file from a source other than Adobe, then your
use, modification, or distribution of it requires the prior written
permission of Adobe.
```

### jsx/json2.js and the UCS list (public domain)

`jsx/json2.js` is declared public domain in its own header (Douglas
Crockford). The Universal Category System data in `js/ucs-data.js` is a
public-domain initiative (see its entry above).
