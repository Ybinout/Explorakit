const path = require('node:path');
// Only content-addressed build assets can safely live in the browser for a year.
// Unversioned sprites, the manifest, worker and HTML keep their revalidation rule.
const HASHED_ASSET = /\.[a-f0-9]{8,64}\.(?:js|css|png|jpe?g|webp|gif|svg|woff2?|ttf|eot|mp3|ogg|wav|mp4|ico)$/i;
function staticAssetHeaders(res, file) {
    if (HASHED_ASSET.test(path.basename(file))) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    else if (path.basename(file) === 'index.html') res.setHeader('Cache-Control', 'no-cache');
}
module.exports = { staticAssetHeaders };
