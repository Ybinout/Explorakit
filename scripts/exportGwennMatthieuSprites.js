// Technical export of imagegen art: crop alpha, native grid, flat palette, integer world scale.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const manifest = require('../docs/GWENN_MATTHIEU_SPRITES.json');
const data = file => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const checks = [];
    for (const entry of manifest.sprites) {
      const result = await page.evaluate(async ({ art, nativeContent, palette, threshold }) => {
        const image = new Image(); image.src = art; await image.decode();
        const source = document.createElement('canvas'); source.width = image.naturalWidth; source.height = image.naturalHeight;
        const sg = source.getContext('2d'); sg.drawImage(image, 0, 0);
        const sourcePixels = sg.getImageData(0, 0, source.width, source.height).data;
        let left = source.width, top = source.height, right = -1, bottom = -1;
        for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
          if (sourcePixels[(y * source.width + x) * 4 + 3] < threshold) continue;
          left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
        }
        if (right < left || bottom < top) throw Error('Empty generated sprite');
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
        const g = canvas.getContext('2d'); g.imageSmoothingEnabled = false;
        const [w, h] = nativeContent;
        g.drawImage(source, left, top, right - left + 1, bottom - top + 1, Math.floor((32 - w) / 2), 32 - h, w, h);
        const pixels = g.getImageData(0, 0, 32, 32);
        const colors = palette.map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
        const used = new Set(); let opaque = 0; const bounds = [32, 32, -1, -1];
        for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
          const i = (y * 32 + x) * 4;
          if (pixels.data[i + 3] < threshold) { pixels.data.set([0, 0, 0, 0], i); continue; }
          let best = colors[0], distance = Infinity;
          for (const color of colors) {
            const d = color.reduce((sum, c, j) => sum + (c - pixels.data[i + j]) ** 2, 0);
            if (d < distance) { best = color; distance = d; }
          }
          pixels.data.set([...best, 255], i); used.add(best.join(',')); opaque++;
          bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y);
          bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y);
        }
        if (opaque < 250 || opaque > 650 || bounds[3] !== 31) throw Error('Unexpected native footprint');
        for (const [x, y] of [[0, 0], [31, 0], [0, 31], [31, 31]]) {
          if (pixels.data[(y * 32 + x) * 4 + 3]) throw Error('Opaque corner');
        }
        g.putImageData(pixels, 0, 0);
        const preview = document.createElement('canvas'); preview.width = preview.height = 384;
        const pg = preview.getContext('2d'); pg.imageSmoothingEnabled = false; pg.drawImage(canvas, 0, 0, 384, 384);
        return { png: canvas.toDataURL().split(',')[1], preview: preview.toDataURL().split(',')[1], opaque,
          bounds: { x: bounds[0], y: bounds[1], w: bounds[2] - bounds[0] + 1, h: bounds[3] - bounds[1] + 1 }, colors: used.size,
          alpha: [0, 255], sourceBounds: { x: left, y: top, w: right - left + 1, h: bottom - top + 1 } };
      }, { art: data(entry.source), nativeContent: entry.nativeContent, palette: manifest.palette, threshold: manifest.alphaThreshold });
      const destination = path.join(root, entry.destination);
      fs.writeFileSync(destination, Buffer.from(result.png, 'base64'));
      fs.writeFileSync('/tmp/riftmon-' + entry.name + '-native-preview.png', Buffer.from(result.preview, 'base64'));
      delete result.png; delete result.preview;
      checks.push({ name: entry.name, destination: entry.destination, ...result,
        bytes: fs.statSync(destination).size, sha256: createHash('sha256').update(fs.readFileSync(destination)).digest('hex') });
    }
    const gallery = await page.evaluate(async sources => {
      const images = await Promise.all(sources.map(async src => { const i = new Image(); i.src = src; await i.decode(); return i; }));
      const c = document.createElement('canvas'); c.width = 768; c.height = 304;
      const g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#e5ede8'; g.fillRect(0, 0, c.width, c.height);
      g.imageSmoothingEnabled = false; g.textAlign = 'center'; g.font = '18px sans-serif';
      for (const [index, image] of images.entries()) {
        const sourceSize = index === 0 ? 64 : 32;
        g.drawImage(image, 0, 0, sourceSize, sourceSize, index * 256, 8, 256, 256);
        g.fillStyle = '#263942'; g.fillText(['Joueur — référence', 'Gwenn', 'Matthieu'][index], index * 256 + 128, 291);
      }
      return c.toDataURL().split(',')[1];
    }, [data(path.join(root, 'vue-explorakit/src/assets/sprite.png')), ...manifest.sprites.map(s => data(path.join(root, s.destination)))]);
    fs.mkdirSync(path.join(root, 'docs/art'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/art/gwenn-matthieu-sprites.png'), Buffer.from(gallery, 'base64'));
    console.log(JSON.stringify(checks, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
