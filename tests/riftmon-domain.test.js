const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
test('RiftMon branding includes installed app, offline page, onboarding and game menus, preserving technical storage keys',()=>{
 const manifest=JSON.parse(read('vue-explorakit/public/manifest.webmanifest'));assert.equal(manifest.name,'RiftMon');assert.equal(manifest.short_name,'RiftMon');assert.equal(manifest.scope,'./');assert.equal(manifest.start_url,'./');
 for(const f of ['public/index.html','public/offline.html','src/components/HomeMenu.vue','src/components/UserInscription.vue','src/components/UserMap.vue','src/components/menu/PokedexPanel.vue','src/components/menu/GameInfoPanels.vue','src/components/PwaInstall.vue']){const s=read('vue-explorakit/'+f);assert.match(s,/RiftMon|RIFTMON/,f);assert.doesNotMatch(s,/Explorakit|EXPLORAKIT/,f);}
 assert.match(read('vue-explorakit/src/services/session.js'),/const SESSION_KEY = 'explorakit.user'/);assert.match(read('vue-explorakit/src/services/gamePreferences.js'),/explorakitGamePreferences/);
});
test('domain configuration keeps RiftMon upstream separate from Knov, redirects old navigation and supports live legacy clients',()=>{
 const domain=read('deploy/nginx-riftmon.conf'),legacy=read('deploy/nginx-location.conf');
 assert.match(domain,/server_name riftmon\.binout\.fr;/);assert.match(domain,/proxy_pass http:\/\/127\.0\.0\.1:3340;/);assert.match(domain,/riftmon\.binout\.fr\/fullchain\.pem/);assert.match(domain,/\.well-known\/acme-challenge/);assert.doesNotMatch(domain,/3333|server_name app\.binout\.fr/);
 assert.match(legacy,/location = \/explorakit \{ return 301 https:\/\/riftmon\.binout\.fr\//);assert.match(legacy,/https:\/\/riftmon\.binout\.fr\/\$1 permanent/);assert.match(legacy,/api\|socket/);assert.match(legacy,/rewrite \^\/explorakit\/\(\.\*\)\$ \/\$1 break/);assert.doesNotMatch(legacy,/location \/ \{/);
 const hook=read('deploy/riftmon-renew-hook');assert.match(hook,/RENEWED_LINEAGE/);assert.match(hook,/\/etc\/letsencrypt\/live\/riftmon\.binout\.fr/);assert.match(hook,/systemctl reload nginx/);
});
