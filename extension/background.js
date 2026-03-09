// --- BADGE MESAJLARI ---
// Content.js'ten gelen badge güncelleme isteklerini uygular.
chrome.runtime.onMessage.addListener((message, sender) => {
    if (message.type === "SET_BADGE" && sender.tab) {
        chrome.action.setBadgeText({ text: message.text, tabId: sender.tab.id });
        chrome.action.setBadgeBackgroundColor({ color: message.color, tabId: sender.tab.id });
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
chrome.tabs.onRemoved.addListener((tabId) => {
    chrome.storage.local.get(['activeTabId'], (result) => {
        // Kapanan tab, JamRoom'un aktif olduğu tab değilse işlem yapma.
        if (result.activeTabId !== tabId) return;

        // Storage'ı temizle: oda oturumu artık geçersiz.
        // roomUserCount ve roomUserList de temizlenir;
        // popup yeniden açılınca "Not in an active room." gösterilir.
        chrome.storage.local.remove([
            'savedRoomId',
            'activeTabId',
            'roomUserCount',
            'roomUserList',
        ]);

        // Badge zaten tab kapandığı için görünmez olur;
        // yine de explicit temizlik yapıyoruz — tab restore edilirse
        // eski "ON" badge'i kalmasın.
        chrome.action.setBadgeText({ text: "", tabId });
    });
});