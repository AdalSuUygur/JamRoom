// --- BADGE MESAJLARI ---
// Content.js'ten gelen badge güncelleme isteklerini uygular.
// [FIREFOX COMPAT] Single compatibility shim — works on Chrome and Firefox.
// Chrome exposes `chrome.*`; Firefox exposes `browser.*`. Both work with `ext`.
const ext = typeof browser !== 'undefined' ? browser : chrome;

ext.runtime.onMessage.addListener((message, sender) => {
    if (message.type === "SET_BADGE" && sender.tab) {
        ext.action.setBadgeText({ text: message.text, tabId: sender.tab.id });
        ext.action.setBadgeBackgroundColor({ color: message.color, tabId: sender.tab.id });
    }
});

// --- TAB KAPANMA TEMİZLİĞİ ---
// Kullanıcı aktif JamRoom tab'ını kapattığında LEAVE_ROOM mesajı gönderilemez
// çünkü content.js zaten yok edilmiştir. Bu listener tab kapanmadan ÖNCE
// tetiklenerek storage ve badge'i temizler.
//
// Neden background.js? Content script'in ömrü tab ile sona erer;
// tab kapanma olayını güvenilir şekilde yakalayabilecek tek yer
// her zaman canlı olan service worker'dır.
ext.tabs.onRemoved.addListener((tabId) => {
    ext.storage.local.get(['activeTabId'], (result) => {
        // Kapanan tab, JamRoom'un aktif olduğu tab değilse işlem yapma.
        //
        // BUG FIX: activeTabId daha önce hiç storage'a yazılmıyordu.
        // Bu yüzden result.activeTabId her zaman undefined geliyordu ve
        // (undefined !== herhangi_bir_sayı) her zaman true döndüğünden
        // bu guard çalışmıyor, her tab kapandığında savedRoomId siliniyordu.
        // Artık popup.js JOIN sırasında SET_ACTIVE_TAB mesajı gönderiyor.
        if (result.activeTabId !== tabId) return;

        // Storage'ı temizle: oda oturumu artık geçersiz.
        ext.storage.local.remove([
            'savedRoomId',
            'activeTabId',
            'roomUserCount',
            'roomUserList',
            'roomQueue',   // Queue da temizlenir; yeni odada eski sıra görünmesin.
        ]);

        ext.action.setBadgeText({ text: "" });
    });
});

// --- ACTIVE TAB KAYDI ---
// popup.js, JOIN_NEW_ROOM sırasında aktif tab ID'sini buraya bildirir.
// background.js bunu storage'a yazar; böylece onRemoved doğru tab'ı tanır.
//
// Neden ayrı bir mesaj tipi?
// popup.js zaten tabs.query ile aktif tab'a erişiyor; bu ID'yi
// doğrudan background'a iletmek en temiz yol — storage'ı popup'tan
// yazmak da işe yarardı ama background service worker'ın her zaman
// ayakta olduğu garantisi daha güvenilir.
ext.runtime.onMessage.addListener((message) => {
    if (message.type === "SET_ACTIVE_TAB" && message.tabId) {
        ext.storage.local.set({ activeTabId: message.tabId });
    }
});