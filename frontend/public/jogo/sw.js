// cache offline do jogo: troque VERSION a cada publicação para forçar a atualização nos aparelhos
const VERSION='padel-lobby-v4';
const CORE=['./','index.html','vendor/three.min.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','../logo.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>n!==VERSION).map(n=>caches.delete(n)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{
    if(r.ok&&(new URL(e.request.url).origin===location.origin||/fonts\.(googleapis|gstatic)\.com/.test(e.request.url))){const cp=r.clone();caches.open(VERSION).then(c=>c.put(e.request,cp));}
    return r;}).catch(()=>caches.match('index.html'))));
});
