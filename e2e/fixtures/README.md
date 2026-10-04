# e2e fixtures

Two different things live here, and the split is worth keeping in mind.

- **Committed binary fixtures** — files the specs open through the app's real
  `File > Open` path. Nothing is downloaded; every file is produced locally by a
  committed generator and the exact bytes are verified in the spec.
- **`extended-test.ts`** — the `test` object every spec imports, which carries the
  `consolePolice` and `pinnedTheme` fixtures described below.

## `extended-test.ts`

Every spec imports `test` (and `expect`, and the types) from here rather than from
`@playwright/test`. The module re-exports everything Playwright exports and adds two `auto`
fixtures. `consolePolice` attaches before the test body and asserts after it: a console error or
page error that is not in `ACCEPTED_CONSOLE_ERRORS` fails the test. `pinnedTheme` seeds
`localStorage.theme` so the pixel oracles keep the light backdrop they are calibrated for under the
app's dark default.

They exist because the alternative was one opt-in point per spec per check. A helper each spec calls
by hand is opt-in, and every one of those points is a chance to forget; an `auto` fixture is
opt-out, which is
the property that matters for a check whose whole value is that nobody can forget it. Playwright
has no global listener hook — `globalSetup` runs in another process with no `page` — so a fixture
is the only mechanism that can be universal.

The file is named `extended-test.ts`, not `extended.test.ts`, on purpose. Playwright's default
`testMatch` requires a literal `.test.ts` suffix, and a file matching it is collected as a suite
of its own and fails the run with "no tests found".

## `split-half-red-blue.png`

The only fixture. 64x64 RGBA, 181 bytes, two solid halves and no anti-aliased
edge, so a spec can assert exact RGB values instead of sampling a colour and
hoping:

| columns           | rgba             | hex       |
| ----------------- | ---------------- | --------- |
| `x` in `[0, 31]`  | `255, 0, 0, 255` | `#ff0000` |
| `x` in `[32, 63]` | `0, 0, 255, 255` | `#0000ff` |

`sha256 9d9971fa54d212310f547f20454ea2642fcd341241924a9eaa468e196c6b809a`

The split is at column 32 of 64, so the colour change sits at exactly 0.5 of the
document's width. `e2e/file-roundtrip.spec.ts` measures it there
(`measureFixtureSplit`).

### Regenerate

```bash
node e2e/fixtures/generate-split-half-png.js
```

The generator writes the 16,384 raw RGBA bytes itself — no input image — and
encodes them with `sharp`, which the e2e helpers already depend on. It is
deterministic: `png({ compressionLevel: 9, palette: false })` on a fixed pixel
buffer, so a rerun reproduces the same file and the sha256 above.

### Verify without running anything

The generator's own comment records the pixel rule, and it is two lines of
arithmetic: 64 rows of 64 pixels, red for `x < 32` and blue for `x >= 32`, alpha
255 everywhere. To confirm the committed file actually matches that rule:

```bash
node -e "
const sharp=require('sharp');
sharp('e2e/fixtures/split-half-red-blue.png').ensureAlpha().raw().toBuffer({resolveWithObject:true})
 .then(({data,info})=>{
   let bad=0;
   for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
     const i=(y*info.width+x)*4;
     const want=x<32?[255,0,0,255]:[0,0,255,255];
     if(data[i]!==want[0]||data[i+1]!==want[1]||data[i+2]!==want[2]||data[i+3]!==want[3])bad++;
   }
   console.log(info.width+'x'+info.height, 'mismatching pixels:', bad);
 });
"
```

It must print `64x64 mismatching pixels: 0`.
