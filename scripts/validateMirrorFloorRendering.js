// Canvas regression recipe: no server, database or player account is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const source = process.env.MIRROR_RENDERER_SOURCE || path.join(__dirname, '../vue-explorakit/src/services/mirrorRiftRenderer.js');
const out = process.env.RELEASE_SCREENSHOTS || '/tmp/riftmon-mirror-floor-rendering';
fs.mkdirSync(out, { recursive: true });

(async () => {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage({ viewport: { width: 896, height: 640 } });
        await page.setContent('<style>body{margin:0}canvas{display:block;image-rendering:pixelated}</style><canvas width="896" height="640"></canvas>');
        await page.evaluate(async ({ source, artwork }) => {
            window.renderer = await import('data:text/javascript;base64,' + source);
            window.art = new Image(); art.src = 'data:image/png;base64,' + artwork; await art.decode();
            window.canvas = document.querySelector('canvas');
            window.c = canvas.getContext('2d', { willReadFrequently: true }); c.imageSmoothingEnabled = false;
            window.state = { ruined: true, stage: 'complete', rift: { x: 13, y: 10 } };
            window.paint = (time, scene = null, motion = true) => {
                c.clearRect(0, 0, 896, 640); c.drawImage(art, 0, 0, 896, 640);
                renderer.drawMirrorGround(c, 'route2_maison', state, scene, time, motion, art);
                return c.getImageData(0, 0, 896, 640).data;
            };
            window.original = paint(0);
            c.clearRect(0, 0, 896, 640); c.drawImage(art, 0, 0, 896, 640);
            original = c.getImageData(0, 0, 896, 640).data;
            window.offscreenRebuilds = 0;
            const clear = CanvasRenderingContext2D.prototype.clearRect;
            CanvasRenderingContext2D.prototype.clearRect = function (...args) {
                if (this.canvas !== canvas) offscreenRebuilds++;
                return clear.apply(this, args);
            };
        }, {
            source: fs.readFileSync(source).toString('base64'),
            artwork: fs.readFileSync(path.join(__dirname, '../vue-explorakit/src/assets/route2_maison.png')).toString('base64')
        });
        const result = await page.evaluate(() => {
            const closed = paint(17000);
            const probes = [[373, 320], [488, 320], [385, 367], [495, 344]].map(([x, y]) => ({
                x, y, rgba: [...closed.slice((y * 896 + x) * 4, (y * 896 + x) * 4 + 4)]
            }));
            if (probes.some(p => p.rgba[0] + p.rgba[1] + p.rgba[2] < 80)) throw Error('The pit hides the broken plank ends');
            const hole = [...closed.slice((336 * 896 + 432) * 4, (336 * 896 + 432) * 4 + 4)];
            if (hole[0] > 12 || hole[1] > 12) throw Error('The central pit was covered');
            const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
            const before = offscreenRebuilds;
            for (let i = 0; i < 50; i++) paint(18000 + i * 100);
            if (offscreenRebuilds !== before) throw Error('The completed room redraws the static effect');
            if (!same(closed, paint(40000))) throw Error('Permanent ruins change with time');
            if (!same(closed, paint(41000, null, false))) throw Error('Reduced motion hides the permanent damage');
            renderer.releaseMirrorEffects();
            if (!same(closed, paint(42000))) throw Error('Recreating the scene loses the broken boards');
            const checkFurniture = frame => {
                for (const [x, y, width, height] of [[256, 350, 66, 70], [516, 350, 60, 70]]) {
                    for (let dy = y; dy < y + height; dy++) for (let dx = x; dx < x + width; dx++) {
                        const p = (dy * 896 + dx) * 4;
                        for (let k = 0; k < 4; k++) if (frame[p + k] !== original[p + k]) throw Error('A piece of furniture was overpainted');
                    }
                }
            };
            checkFurniture(closed);
            state.stage = 'open'; checkFurniture(paint(43000));
            for (const time of [800, 2600, 4800, 7400]) {
                checkFurniture(paint(time, { map: 'route2_maison', phase: 'opening', startedAt: 0, duration: 8000 }));
            }
            state.stage = 'complete'; paint(44000);
            return { brokenEndsVisible: true, probes, hole, furniturePreserved: true, persistentAfterRecreation: true, completedTextureRebuildsFor50Frames: 0, reducedMotionPreservesRuins: true };
        });
        await page.screenshot({ path: path.join(out, 'complete.png') });
        for (const time of [800, 2600, 4800, 7400]) {
            await page.evaluate(time => { state.stage = 'open'; paint(time, { map: 'route2_maison', phase: 'opening', startedAt: 0, duration: 8000 }); }, time);
            await page.screenshot({ path: path.join(out, 'opening-' + time + '.png') });
        }
        await page.evaluate(() => { state.stage = 'open'; paint(16000); });
        await page.screenshot({ path: path.join(out, 'open.png') });
        assert(result.brokenEndsVisible);
        fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n');
        console.log(JSON.stringify(result));
    } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
