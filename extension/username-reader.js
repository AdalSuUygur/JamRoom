/**
 * username-reader.js — MAIN world script
 *
 * Bu script manifest.json'da "world": "MAIN" ile tanımlandığı için
 * sayfanın gerçek window objesiyle aynı context'te çalışır.
 * window.yt.config_.USER_ACCOUNT_NAME'e doğrudan erişebilir.
 *
 * Okuduğu değeri postMessage ile ISOLATED world'deki content.js'e iletir.
 * content.js bunu usernamePromise üzerinden yakalar.
 */
window.postMessage({
    type: 'JAMROOM_USERNAME',
    username: window.yt?.config_?.USER_ACCOUNT_NAME || null,
}, '*');
