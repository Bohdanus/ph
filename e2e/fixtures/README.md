# e2e fixtures

Committed binary fixtures the Playwright specs open through the app's real
`File > Open` path. Nothing here is downloaded; every file is produced locally by
a committed generator and the exact bytes are verified in the spec.

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
