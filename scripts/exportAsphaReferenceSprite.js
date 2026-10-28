// Technical export of imagegen art. Never redraw or quantize the original dog.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto'), { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), manifest = require('../docs/ASPHA_REFERENCE_SPRITE.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = fs.readFileSync(process.argv[2] || manifest.source);
assert.equal(hash(source), manifest.sourceSha256, 'Unexpected generated source');
const original = execFileSync('git', ['-C', path.join(root, 'vue-explorakit'), 'show', manifest.baselineClient + ':src/assets/pnj/aspha-pixel-v2.png']);
assert.equal(hash(original), manifest.baselineAssetSha256, 'Unexpected original dog');

(async () => {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        const result = await page.evaluate(async ({ source, original, spec }) => {
            const load = async data => { const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode(); return image; };
            const [art, old] = await Promise.all([load(source), load(original)]);
            const canvas = document.createElement('canvas'); [canvas.width, canvas.height] = spec.canvas;
            const context = canvas.getContext('2d'); context.imageSmoothingEnabled = false;
            context.drawImage(art, ...spec.sourceCrop, ...spec.nativeBox);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
            for (let i = 0; i < pixels.data.length; i += 4) {
                if (pixels.data[i + 3] < spec.alphaThreshold) { pixels.data.set([0, 0, 0, 0], i); continue; }
                let best = spec.palette[0], distance = Infinity;
                for (const color of spec.palette) {
                    const d = color.reduce((n, v, k) => n + (v - pixels.data[i + k]) ** 2, 0);
                    if (d < distance) { best = color; distance = d; }
                }
                pixels.data.set([...best, 255], i);
            }
            context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(old, 0, 0);
            const before = context.getImageData(0, 0, canvas.width, canvas.height).data;
            const protectedAt = (x, y) => spec.preservedRects.some(([rx, ry, w, h]) => x >= rx && x < rx + w && y >= ry && y < ry + h);
            let preservedPixels = 0, changedTrainerPixels = 0;
            for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
                const i = (y * canvas.width + x) * 4;
                if (protectedAt(x, y)) { pixels.data.set(before.slice(i, i + 4), i); preservedPixels++; }
                else if (pixels.data.slice(i, i + 4).some((v, k) => v !== before[i + k])) changedTrainerPixels++;
            }
            context.putImageData(pixels, 0, 0);
            const png = canvas.toDataURL();
            const decoded = await load(png.split(',')[1]);
            context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(decoded, 0, 0);
            const after = context.getImageData(0, 0, canvas.width, canvas.height).data;
            const dogBytes = [];
            for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (protectedAt(x, y)) {
                const i = (y * canvas.width + x) * 4;
                for (let k = 0; k < 4; k++) {
                    if (before[i + k] !== after[i + k]) throw Error('Dog or leash changed after PNG encoding');
                    dogBytes.push(after[i + k]);
                }
            }
            const preview = document.createElement('canvas'); preview.width = 480; preview.height = 384;
            const p = preview.getContext('2d'); p.fillStyle = '#cad7cf'; p.fillRect(0, 0, 480, 384);
            p.imageSmoothingEnabled = false; p.drawImage(canvas, 0, 0, 480, 384);
            return { png: png.split(',')[1], preview: preview.toDataURL().split(',')[1], dogBytes, preservedPixels, changedTrainerPixels };
        }, { source: source.toString('base64'), original: original.toString('base64'), spec: manifest });
        assert(result.changedTrainerPixels > 0);
        const png = Buffer.from(result.png, 'base64');
        fs.writeFileSync(path.join(root, manifest.asset), png);
        fs.writeFileSync('/tmp/riftmon-aspha-reference-preview.png', Buffer.from(result.preview, 'base64'));
        const report = { preservedPixels: result.preservedPixels, changedTrainerPixels: result.changedTrainerPixels,
            dogAndLeashUnchanged: true, preservedRgbaSha256: hash(Buffer.from(result.dogBytes)), assetSha256: hash(png), width: 40, height: 32, bytes: png.length };
        fs.writeFileSync('/tmp/riftmon-aspha-reference-export.json', JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify(report));
    } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
