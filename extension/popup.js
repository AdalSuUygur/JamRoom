// -------------------------------------------
// JamRoom - popup.js (Firefox Uyumlu)
// -------------------------------------------

const countDisplay = document.getElementById('countDisplay');
const roomInput = document.getElementById('roomInput');

function setStatus(text) {
  if (countDisplay) {
    countDisplay.innerText = text;
  }
}

document.getElementById('joinBtn').addEventListener('click', () => {
  const roomId = roomInput.value.trim();

  if (!roomId) {
    setStatus("Please enter a room name.");
    return; 
  }

  // [FIREFOX PORT DETAYI]: chrome.tabs.query(query, (tabs) => {...}) callback yapısı,
  // Firefox'un native Promise yapısına ( .then((tabs) => {...}) ) dönüştürüldü.
  browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    const currentTab = tabs[0];

    // Aktif sekmenin bir YouTube sekmesi olup olmadığını kontrol et
    if (!currentTab || !currentTab.url || !currentTab.url.includes("youtube.com")) {
      setStatus("Open a YouTube tab to use JamRoom.");
      return; 
    }

    // Odayı local storage'a kaydet (yine Promise yapısıyla)
    browser.storage.local.set({ savedRoomId: roomId }).then(() => {
      sendMessageToContent("JOIN_NEW_ROOM", roomId);
      setStatus(`Joining: ${roomId}...`);
    });
  });
});

document.getElementById('leaveBtn').addEventListener('click', () => {
  sendMessageToContent("LEAVE_ROOM", null);
  browser.storage.local.remove(['savedRoomId', 'roomUserCount']);
  setStatus("Not in an active room.");
});

// İlgili sekmeye mesaj gönderen yardımcı fonksiyon
function sendMessageToContent(type, data) {
  browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    if (!tabs[0]) return;

    browser.tabs.sendMessage(tabs[0].id, {
      type: type,
      roomId: data
    });

    // Rozet (badge) güncellemeleri
    if (type === "JOIN_NEW_ROOM") {
      browser.action.setBadgeText({ text: "ON", tabId: tabs[0].id });
      browser.action.setBadgeBackgroundColor({ color: "#00FF00", tabId: tabs[0].id });
    } else if (type === "LEAVE_ROOM") {
      browser.action.setBadgeText({ text: "", tabId: tabs[0].id });
    }
  });
}

// Gelen mesajları dinleme (Odaya başarıyla girildiğinde tetiklenir)
browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "ROOM_JOINED") {
    if (msg.roomId) {
      roomInput.value = msg.roomId;
    }
    setStatus(`Joined: ${msg.roomId}`);

    // Kullanıcı sayısını senkronize etmek için ufak bir gecikme
    setTimeout(() => {
      browser.storage.local.get(['roomUserCount']).then((res) => {
        const count = res.roomUserCount || 1;
        setStatus(`In room: ${count} users`);
      });
    }, 1200);
  }
});

// Popup ilk açıldığında çalışacak init fonksiyonu
browser.storage.local.get(['savedRoomId', 'roomUserCount']).then((result) => {
  if (result.savedRoomId) {
    roomInput.value = result.savedRoomId;
    const count = result.roomUserCount || 1;
    setStatus(`In room: ${count} users`);
  } else {
    roomInput.value = "";
    setStatus("Not in an active room.");
  }
});