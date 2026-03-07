// [FIREFOX PORT DETAYI]: chrome.* yerine browser.* API'si kullanılıyor.
// Firefox geriye dönük olarak chrome.* desteklese de, yerel ve kararlı olan browser.* kullanmaktır.
// Sahneden (content.js) veya popup.js'den gelen "Işığı Yak" veya "Söndür" emirlerini dinler.
browser.runtime.onMessage.addListener((message, sender) => {
    // Sekme id'sine göre ikonun üzerindeki rozeti (badge) günceller.
    if (message.type === "SET_BADGE" && sender.tab) {
        browser.action.setBadgeText({ text: message.text, tabId: sender.tab.id });
        browser.action.setBadgeBackgroundColor({ color: message.color, tabId: sender.tab.id });
    }
});