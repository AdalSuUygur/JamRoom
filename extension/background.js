// Sahneden (content.js) gelen "Işığı Yak" veya "Söndür" emirlerini dinle
chrome.runtime.onMessage.addListener((message, sender) => {
    if (message.type === "SET_BADGE" && sender.tab) {
        chrome.action.setBadgeText({ text: message.text, tabId: sender.tab.id });
        chrome.action.setBadgeBackgroundColor({ color: message.color, tabId: sender.tab.id });
    }
});