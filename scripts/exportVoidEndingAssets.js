// Lossless pixel masters are kept outside the client; only exported assets ship.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const assets = [
    ['void_arena.png', 'src/assets/void_arena.png', 448, 320],
    ['void-arena-wide-v1.png', 'src/assets/battle/void-arena-wide-v1.webp', 960, 640],
    ['void-arena-mobile-v1.png', 'src/assets/battle/void-arena-mobile-v1.webp', 640, 960],
    ['professor-final-v1.png', 'src/assets/battle/professor-final-v1.png', 240, 400],
    ['professor-ko-pixel-v1.png', 'src/assets/pnj/professor-ko-pixel-v1.png', 32, 32]
];
(async () => {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        for (const [source, dest, width, height] of assets) {
            const bytes = fs.readFileSync(path.join(root, 'docs/art/void-ending', source));
            const encoded = await page.evaluate(async ({ src, width, height, webp }) => {
                const image = new Image(); image.src = src; await image.decode();
                if (image.width !== width || image.height !== height) throw Error('Pixel master size mismatch');
                const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
                const context = canvas.getContext('2d'); context.imageSmoothingEnabled = false;
                context.drawImage(image, 0, 0);
                return canvas.toDataURL(webp ? 'image/webp' : 'image/png', .96).split(',')[1];
            }, { src: 'data:image/png;base64,' + bytes.toString('base64'), width, height, webp: dest.endsWith('.webp') });
            const target = path.join(root, 'vue-explorakit', dest), result = Buffer.from(encoded, 'base64');
            if (process.argv.includes('--check')) assert(fs.readFileSync(target).equals(result), dest);
            else fs.writeFileSync(target, result);
            console.log(JSON.stringify({ asset: dest, size: [width, height], bytes: result.length }));
        }
        const blank = await page.evaluate(() => {
            const canvas = document.createElement('canvas'); canvas.width = 448; canvas.height = 320;
            return canvas.toDataURL().split(',')[1];
        });
        const target = path.join(root, 'vue-explorakit/src/assets/void_arena_f.png');
        if (process.argv.includes('--check')) assert(fs.readFileSync(target).equals(Buffer.from(blank, 'base64')), 'void_arena_f');
        else fs.writeFileSync(target, Buffer.from(blank, 'base64'));
    } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
