const CACHE_NAME = 'mahims-ledger-v11';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// অ্যাপ-শেল ফাইল (HTML/CSS/JS) — নেটওয়ার্ক-ফার্স্ট: ইন্টারনেট থাকলে সবসময় সর্বশেষ
// ভার্সন আনা হবে এবং ক্যাশ আপডেট হবে; অফলাইনে থাকলে ক্যাশ করা ভার্সন দেখাবে।
// বাহ্যিক CDN/Firebase রিকোয়েস্ট সরাসরি নেটওয়ার্কে যায় (ক্লাউড সিঙ্কের জন্য জরুরি)।
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request).then(response => {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      return response;
    }).catch(() => caches.match(event.request))
  );
});
