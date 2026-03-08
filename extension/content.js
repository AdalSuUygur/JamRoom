let roomId = null; 
let socket = null;
let isRemoteAction = false; 
let video = null; 
let currentUrl = location.href;

// 1. BAĞLANTI FONKSİYONU
function connect(id) {
    if (socket) socket.disconnect(); 
    
    // Artık config dosyasından çekiyoruz:
    socket = io(CONFIG.SERVER_URL); 
    roomId = id;

    socket.on('connect', () => {
        console.log("✅ Connected to server. Room:", roomId);
        socket.emit('joinRoom', roomId);
    });
    // Sunucudan gelen kişi sayısını Chrome hafızasına yaz
    socket.on('userCountUpdate', (count) => {
        chrome.storage.local.set({ roomUserCount: count });
    });
    socket.on('videoActionFromServer', (data) => {
        handleServerAction(data);
    });

    socket.on('getSyncData', (targetId) => {
        if (video) {
            socket.emit('sendSyncData', {
                targetId: targetId,
                action: {
                    type: 'SYNC',
                    newUrl: location.href,
                    time: video.currentTime,
                    state: !video.paused
                }
            });
        }
    });
}

// 2. BEKLEYEN SENKRONİZASYONU UYGULA 
function applyPendingSync() {
    const pendingTime = sessionStorage.getItem('pendingSyncTime');
    const pendingState = sessionStorage.getItem('pendingSyncState');

    if (pendingTime && video) {
        console.log("⏳ Applying pending sync...");
        
        // Video verisi yüklenene kadar bekle
        video.onloadedmetadata = () => {
            isRemoteAction = true;
            video.currentTime = parseFloat(pendingTime);
            
            if (pendingState === 'true') video.play(); else video.pause();
            
            // İşlem bitince temizle
            sessionStorage.removeItem('pendingSyncTime');
            sessionStorage.removeItem('pendingSyncState');
            
            setTimeout(() => { isRemoteAction = false; }, 1000);
        };

        // Eğer video zaten yüklüyse direkt çalıştır
        if (video.readyState >= 1) {
            video.onloadedmetadata();
        }
    }
}

// URL'den sadece Video ID'sini çeken yardımcı fonksiyon
function getVideoId(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.searchParams.get("v");
    } catch (e) {
        return null;
    }
}

// 3. KOMUT MERKEZİ
function handleServerAction(data) {
    isRemoteAction = true;
    console.log("📥 Server action:", data.type);

    if (data.type === 'URL_CHANGE' || data.type === 'SYNC') {
        const currentVideoId = getVideoId(location.href);
        const incomingVideoId = getVideoId(data.newUrl);

        // Sadece Video ID'lerini karşılaştırıyoruz
        if (currentVideoId !== incomingVideoId) {
            if (data.type === 'SYNC') {
                sessionStorage.setItem('pendingSyncTime', data.time);
                sessionStorage.setItem('pendingSyncState', data.state);
            }
            sessionStorage.setItem('isRemoteNavigating', 'true');
            window.location.href = data.newUrl;
            return; 
        }
    }

    if (video) {
        if (data.type === 'PLAY' || (data.type === 'SYNC' && data.state)) {
            video.play();
        } else if (data.type === 'PAUSE' || (data.type === 'SYNC' && !data.state)) {
            video.pause();
        }

        if (data.type === 'SEEK' || data.type === 'SYNC') {
            const timeDiff = Math.abs(video.currentTime - data.time);
            if (timeDiff > 1) {
                video.currentTime = data.time;
            }
        }
    }

    setTimeout(() => { isRemoteAction = false; }, 1000);
}

// 4. SAYFA VE VİDEO TAKİBİ
function checkPageStatus() {
    if (!socket) return;

    // Sadece video elementini bulup olayları bağlıyoruz, bozuk URL kontrolü silindi
    const v = document.querySelector('video');
    if (v && v !== video) {
        video = v;
        attachEvents(video);
        applyPendingSync();
    }
}

function attachEvents(v) {
    v.onplay = () => { if (!isRemoteAction && socket) socket.emit('videoAction', { type: 'PLAY', roomId }); };
    v.onpause = () => { if (!isRemoteAction && socket) socket.emit('videoAction', { type: 'PAUSE', roomId }); };
    v.onseeking = () => { 
        if (!isRemoteAction && socket) {
            socket.emit('videoAction', { type: 'SEEK', time: v.currentTime, roomId });
        }
    };
}

setInterval(checkPageStatus, 1000);

// --- YOUTUBE SENSÖRÜ ---
window.addEventListener('yt-navigate-finish', () => {
    // 1. Eğer bu geçişi zaten sunucudan gelen bir komutla yaptıysak, geri bildirim (echo) oluşmasın diye duruyoruz.
    const isRemoteNav = sessionStorage.getItem('isRemoteNavigating');
    if (isRemoteNav === 'true') {
        sessionStorage.removeItem('isRemoteNavigating');
        console.log("🤫 Navigated due to a server action; suppressing echo feedback.");
        return; // Fonksiyonu burada durduruyoruz, sunucuya mesaj atmıyoruz.
    }

    if (!socket || isRemoteAction) return; // Bağlantı yoksa bir şey yapma
    
    const currentUrl = location.href;
    
    if (currentUrl.includes("watch?v=")) {
        const pureUrl = cleanYouTubeUrl(currentUrl); 

        // KRİTİK EKLEME: Eğer şu anki link kirliyse (mix/playlist içeriyorsa)
        if (currentUrl !== pureUrl) {
            console.log("🧹 Cleaning playlist parameters from the current URL...");
            // Kendi adres çubuğunu sessizce temizle (sayfayı yenilemeden)
            window.history.replaceState({}, '', pureUrl);
        }

        console.log("🔗 Sending cleaned URL to the room:", pureUrl);
        socket.emit('videoAction', { 
            type: 'URL_CHANGE', 
            newUrl: pureUrl, 
            roomId: roomId,
            time: 0,
            state: true
        });
        
        // Kısa süreliğine kendi hareketlerimizi kilitleyelim ki sonsuz döngü olmasın
        isRemoteAction = true;
        setTimeout(() => { isRemoteAction = false; }, 1000);
    }
});
// ------------------------------------------

// 5. POPUP'TAN GELEN MESAJLAR
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "JOIN_NEW_ROOM") {
        sessionStorage.setItem('jamActive', 'true');
        connect(message.roomId);

    // Let the popup know we joined successfully
        chrome.runtime.sendMessage({
        type: "ROOM_JOINED",
        roomId: message.roomId
        });
    }
    else if (message.type === "LEAVE_ROOM") {
        if (socket) {
            // Sunucuya odadan çıktığımızı kibarca söylüyoruz
            socket.emit('leaveRoom', roomId);
            // Bağlantıyı tamamen koparıyoruz
            socket.disconnect();
            // Belleği temizliyoruz
            socket = null;
            roomId = null;
        }
        // session storage temizliği (Otomatik bağlanmayı durdurur)
        sessionStorage.removeItem('jamActive');

        // Rozeti temizle (Background script üzerinden)
        chrome.runtime.sendMessage({ type: "SET_BADGE", text: "" });

        console.log("✅ JamRoom: Left the room and disconnected.");
    }
});

// Sayfa yenilendiğinde (veya yeni müziğe geçildiğinde) kopmamak için:
if (sessionStorage.getItem('jamActive') === 'true') {
    chrome.storage.local.get(['savedRoomId'], (res) => {
        if (res.savedRoomId) {
            connect(res.savedRoomId); // İsim yok, sadece odaya bağlanıyoruz
            
            // YENİ: Bekçiye haber ver, yeni şarkıya geçsek de ışığı açık tutsun
            chrome.runtime.sendMessage({ type: "SET_BADGE", text: "ON", color: "#00FF00" });
        }
    });
} else {
    // Odada değilsek rozeti temizle
    chrome.runtime.sendMessage({ type: "SET_BADGE", text: "", color: "#00FF00" });
}
// Yardımcı Fonksiyon: YouTube linkindeki playlist (list) ve sıra (index) parametrelerini temizler
function cleanYouTubeUrl(rawUrl) {
    try {
        const urlObj = new URL(rawUrl);
        urlObj.searchParams.delete('list');
        urlObj.searchParams.delete('index');
        urlObj.searchParams.delete('start_radio');
        return urlObj.toString();
    } catch (e) {
        return rawUrl; // Bir hata olursa orijinal linki geri döndür
    }
}