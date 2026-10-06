# Build-time tools (never shipped)

Used by `scripts/check-code.js` (every build) and `scripts/strip-comments.js`
(only with `STRIP_COMMENTS=1`). Not part of the package.

| File | Package | License | sha256 |
|---|---|---|---|
| `acorn-8.15.0.js` | acorn 8.15.0, `dist/acorn.js` | MIT (`acorn-LICENSE`) | `fdb08546776ec6228b03e8d02b40d4ab3255bae5f401adba7ff5dad927ac5c9c` |
| `esprima-4.0.1.js` | esprima 4.0.1, `dist/esprima.js` | BSD-2-Clause (`esprima-LICENSE`) | `6c36c0e60387f5398f98f68ac76ae832688b32fa9162eae4cc9b6b2cad5f554e` |

Taken from the npm packages above, with these integrity values:
- acorn 8.15.0: `sha512-NZyJarBfL7nWwIq+FDL6Zp/yHEhePMNnnJ0y3qfieCrmNvYct8uvtiV41UvlSe6apAfk0fY1FbWx+NwfmpvtTg==`
- esprima 4.0.1: `sha512-eGuFFw7Upda+g4p+QHvnW0RyTX/SVeJBDM/gCtMARO0cLuT2HcEKnTPvhjV6aGeqrCB/sbNop0Kszm0jsaWU4A==`

`strip-comments.js` checks both hashes before running and refuses to build
if either file changed. Pinned by hand, never updated automatically.
