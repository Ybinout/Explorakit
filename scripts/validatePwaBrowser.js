// Isolated browser profile and static server: no production account or OS installation.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const {once} = require('node:events');
const express = require('express');
const {chromium} = require('playwright');
const dist = process.env.RELEASE_DIST_DIR || '/tmp/explorakit-release-dist';
const output = process.env.RELEASE_SCREENSHOTS || '/tmp/explorakit-six-browser';
const mount = process.env.RELEASE_PUBLIC_PATH || '/explorakit/';
if (!['/', '/explorakit/'].includes(mount)) throw Error('Unsupported PWA test scope');
fs.mkdirSync(output,{recursive:true});
(async()=>{
  const app=express(),server=http.createServer(app),other=http.createServer((_q,r)=>r.end('Other project'));let browser;
  app.get('/other-project',(_req,res)=>res.send('Other project'));
  app.get(mount+'api/probe',(_req,res)=>res.set('Cache-Control','no-store').json({private:true}));
  app.use(mount,express.static(dist));
  app.get(mount+'*',(_req,res)=>res.sendFile(path.join(dist,'index.html')));
  try {
    server.listen(0,'127.0.0.1');await once(server,'listening');
    other.listen(0,'127.0.0.1');await once(other,'listening');
    const origin=`http://127.0.0.1:${server.address().port}`,base=origin+mount;
    const otherProject=mount==='/'?`http://127.0.0.1:${other.address().port}/`:origin+'/other-project';
    browser=await chromium.launch({headless:true});
    // A narrow/touch-enabled PC remains a PC; viewport size is not eligibility.
    const desktop=await browser.newContext({hasTouch:true,userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'});
    const desktopPage=await desktop.newPage();
    for(const width of [1365,393]){
      await desktopPage.setViewportSize({width,height:900});await desktopPage.goto(base);await desktopPage.locator('[data-mode-menu]').waitFor();
      assert.equal(await desktopPage.locator('[data-pwa-install]').count(),0,'PC installation card must stay hidden, even with touch / narrow window');
    }
    await desktop.close();
    const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true,userAgent:'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'api/probe');
    await page.evaluate(()=>caches.open('another-project-cache'));
    await page.goto(base);await page.locator('[data-pwa-install]').waitFor();
    await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));});
    assert.equal(await page.evaluate(async()=>(await navigator.serviceWorker.ready).scope),base);
    const manifestUrl=await page.locator('link[rel="manifest"]').getAttribute('href');
    const response=await page.request.get(new URL(manifestUrl,base).href);assert(response.ok());
    const manifest=await response.json();assert.equal(manifest.display,'standalone');assert.equal(manifest.name,'RiftMon');assert.equal(manifest.short_name,'RiftMon');
    for(const field of ['id','scope','start_url'])assert.equal(new URL(manifest[field],new URL(manifestUrl,base)).href,base);
    for(const icon of manifest.icons){const r=await page.request.get(new URL(icon.src,base).href);assert(r.ok());assert.match(r.headers()['content-type'],/image\/png/);}
    const cdp=await context.newCDPSession(page);await cdp.send('Page.enable');
    const installability=await cdp.send('Page.getInstallabilityErrors');assert.deepEqual(installability.installabilityErrors,[]);
    // Native prompt must only be called on a user gesture, and only once.
    await page.evaluate(()=>{window.promptCalls=0;const event=new Event('beforeinstallprompt',{cancelable:true});event.prompt=async()=>{window.promptCalls++;};event.userChoice=Promise.resolve({outcome:'dismissed'});window.dispatchEvent(event);});
    assert.equal(await page.evaluate(()=>window.promptCalls),0);
    await page.locator('[data-pwa-install] button').click();await page.locator('#install-help').waitFor();
    assert.equal(await page.evaluate(()=>window.promptCalls),1);
    await page.screenshot({path:path.join(output,'pwa-install-mobile.png'),fullPage:true});
    await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));
    assert.equal(await page.locator('[data-pwa-install]').count(),0);
    assert.deepEqual(await page.evaluate(async()=>fetch('api/probe').then(r=>r.json())),{private:true});
    const cached=await page.evaluate(async()=>{const names=await caches.keys();return {names,urls:(await Promise.all(names.map(async name=>(await (await caches.open(name)).keys()).map(r=>r.url)))).flat()};});
    assert(cached.names.includes('another-project-cache'));assert.deepEqual(cached.urls,[base+'offline.html']);
    await context.setOffline(true);
    assert(await page.evaluate(async()=>{try{await fetch('api/probe');return false;}catch{return true;}}));
    await page.goto(base+'colosseum/game');await page.getByRole('heading',{name:'Retrouvons le chemin.'}).waitFor();
    assert.equal(await page.locator('#app').count(),0);await page.screenshot({path:path.join(output,'pwa-offline-mobile.png')});
    await context.setOffline(false);await page.goto(base);await page.locator('[data-mode-menu]').waitFor();
    await page.goto(otherProject);assert.equal(await page.evaluate(()=>navigator.serviceWorker.controller),null);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({pwa:true,desktopCardHidden:[1365,393],touchPcHidden:true,mobileCardVisible:true,installability,scope:base,nativePrompt:true,offlineFallback:true,apiNeverCached:true,otherProjectUnaffected:true,output}));
  } finally {await browser?.close();await new Promise(r=>server.close(r));await new Promise(r=>other.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
