
// Multiple compatibility — works on Chrome and Firefox.
// Chrome exposes `chrome.*`; Firefox exposes `browser.*`. Both work with `ext`.
const ext = typeof browser !== 'undefined' ? browser : chrome;

ext.runtime.onMessage.addListener((message, sender) => {
    if (message.type === "SET_BADGE" && sender.tab) {
        ext.action.setBadgeText({ text: message.text, tabId: sender.tab.id });
        ext.action.setBadgeBackgroundColor({ color: message.color, tabId: sender.tab.id });
    }
});

// --- TAB KAPANMA TEMİZLİĞİ ---
ext.tabs.onRemoved.addListener((tabId) => {
    ext.storage.local.get(['activeTabId'], (result) => {
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
ext.runtime.onMessage.addListener((message) => {
    if (message.type === "SET_ACTIVE_TAB" && message.tabId) {
        ext.storage.local.set({ activeTabId: message.tabId });
    }
});

// --- BADGE RESTORE ON TAB SWITCH ---
// Kullanıcı başka bir tab'a geçip aktif JamRoom tab'ına geri döndüğünde badge'i yeniden uygular.
ext.tabs.onActivated.addListener(({ tabId }) => {
    ext.storage.local.get(['activeTabId'], (result) => {
        if (result.activeTabId !== tabId) {
            // Bu JamRoom'un aktif tab'ı değil — badge'i temizle.
            ext.action.setBadgeText({ text: '', tabId });
            return;
        }
        // JamRoom'un aktif tab'ına döndük — yeşil badge'i restore et.
        ext.action.setBadgeText({ text: 'ON', tabId });
        ext.action.setBadgeBackgroundColor({ color: '#00FF00', tabId });
    });
});