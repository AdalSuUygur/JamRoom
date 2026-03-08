// -------------------------------------------
// JamRoom - popup.js
// -------------------------------------------

// Popup içindeki durum metnini gösteren <p> elementi
const countDisplay = document.getElementById('countDisplay');

// Oda adının girildiği input alanı
const roomInput = document.getElementById('roomInput');


// -------------------------------------------
// Yardımcı Fonksiyon: UI durum mesajı güncelleme
// Alert yerine kullanıcıya popup içinde mesaj gösterir
// -------------------------------------------
function setStatus(text) {
  if (countDisplay) {
    countDisplay.innerText = text;
  }
}


// -------------------------------------------
// JOIN BUTONU TIKLANDIĞINDA ÇALIŞIR
// -------------------------------------------
document.getElementById('joinBtn').addEventListener('click', () => {

  // Kullanıcının yazdığı oda adını alıyoruz
  const roomId = roomInput.value.trim();

  // Eğer oda adı boşsa kullanıcıyı popup içinden bilgilendiriyoruz
  if (!roomId) {
    setStatus("Please enter a room name.");
    return; // İşlemi durdur
  }

  // Aktif sekmeyi kontrol ediyoruz
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentTab = tabs[0];

    // Eğer aktif sekme yoksa veya YouTube değilse kullanıcıya bilgi ver
    if (!currentTab || !currentTab.url || !currentTab.url.includes("youtube.com")) {
      setStatus("Open a YouTube tab to use JamRoom.");
      return; // İşlemi durdur
    }

    // Oda adını Chrome local storage'a kaydediyoruz
    // Bu sayede popup kapanıp açılsa bile oda bilgisi hatırlanır
    chrome.storage.local.set({ savedRoomId: roomId }, () => {

      // Content script'e JOIN komutu gönderiyoruz
      sendMessageToContent("JOIN_NEW_ROOM", roomId);

      // Kullanıcıya anlık geri bildirim
      setStatus(`Joining: ${roomId}...`);
    });
  });
});


// -------------------------------------------
// LEAVE BUTONU TIKLANDIĞINDA ÇALIŞIR
// -------------------------------------------
document.getElementById('leaveBtn').addEventListener('click', () => {

  // Content script'e odadan çık komutu gönder
  sendMessageToContent("LEAVE_ROOM", null);

  // Local storage'dan kayıtlı oda ve kullanıcı sayısını temizle
  chrome.storage.local.remove(['savedRoomId', 'roomUserCount']);

  // UI durumunu sıfırla
  setStatus("Not in an active room.");
});


// -------------------------------------------
// Content Script'e Mesaj Gönderme Fonksiyonu
// Aynı zamanda badge kontrolü yapar
// -------------------------------------------
function sendMessageToContent(type, data) {

  // Aktif sekmeyi bul
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {

    if (!tabs[0]) return;

    // Content script'e mesaj gönder
    chrome.tabs.sendMessage(tabs[0].id, {
      type: type,
      roomId: data
    });

    // Badge kontrolü (extension ikonunun üstündeki ON yazısı)
    if (type === "JOIN_NEW_ROOM") {

      // Odaya girince badge'i aktif yap
      chrome.action.setBadgeText({ text: "ON", tabId: tabs[0].id });
      chrome.action.setBadgeBackgroundColor({ color: "#00FF00", tabId: tabs[0].id });

    } else if (type === "LEAVE_ROOM") {

      // Odadan çıkınca badge'i temizle
      chrome.action.setBadgeText({ text: "", tabId: tabs[0].id });
    }
  });
}


// -------------------------------------------
// Content Script'ten Gelen Mesajları Dinleme
// JOIN başarılı olduğunda geri bildirim alır
// -------------------------------------------
chrome.runtime.onMessage.addListener((msg) => {

  if (msg.type === "ROOM_JOINED") {

    // Input alanını güncel oda adıyla senkronize et
    if (msg.roomId) {
      roomInput.value = msg.roomId;
    }

    // Kullanıcıya kısa süreli başarı mesajı göster
    setStatus(`Joined: ${msg.roomId}`);

    // 1.2 saniye sonra kullanıcı sayısını göster
    setTimeout(() => {
      chrome.storage.local.get(['roomUserCount'], (res) => {
        const count = res.roomUserCount || 1;
        setStatus(`In room: ${count} users`);
      });
    }, 1200);
  }
});


// -------------------------------------------
// Popup açıldığında önceki oda bilgisini geri yükleme
// -------------------------------------------
chrome.storage.local.get(['savedRoomId', 'roomUserCount'], (result) => {

  if (result.savedRoomId) {

    // Eğer daha önce bir odaya girilmişse input'u doldur
    roomInput.value = result.savedRoomId;

    // Kullanıcı sayısını göster (yoksa 1 varsay)
    const count = result.roomUserCount || 1;
    setStatus(`In room: ${count} users`);

  } else {

    // Eğer kayıtlı oda yoksa temiz başlangıç yap
    roomInput.value = "";
    setStatus("Not in an active room.");
  }
});