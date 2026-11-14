# Build-time tools (never shipped)

These files are used by `scripts/check-code.js` (every build) and
`scripts/strip-comments.js` (only with `STRIP_COMMENTS=1`). They are not
part of the package.

| File | Package | License | sha256 |
|---|---|---|---|
| `acorn-8.19.0.js` | acorn 8.19.0, `dist/acorn.js` | MIT (`acorn-LICENSE`) | `b95392d79457d0357555c5ed3e56302d074b92dff119bcf3b44179500b10e9df` |
| `esprima-4.0.1.js` | esprima 4.0.1, `dist/esprima.js` | BSD-2-Clause (`esprima-LICENSE`) | `6c36c0e60387f5398f98f68ac76ae832688b32fa9162eae4cc9b6b2cad5f554e` |

Taken from the npm packages above, with these integrity values:
- acorn 8.19.0: `sha512-oJlA3XiRm7Cyk6qFD2Jn8ak9B7jSy0qy00ADO3+8dpT0LSjFihQYv4C02LFCSYJV3Q37xYwwRy5m+IpIiUzqWw==`
- esprima 4.0.1: `sha512-eGuFFw7Upda+g4p+QHvnW0RyTX/SVeJBDM/gCtMARO0cLuT2HcEKnTPvhjV6aGeqrCB/sbNop0Kszm0jsaWU4A==`

`strip-comments.js` checks both hashes before running and refuses to build
if either file changed. Both files are pinned by hand and never updated
automatically.
