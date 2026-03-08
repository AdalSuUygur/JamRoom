/**
 * JAMROOM CONTENT SCRIPT - Version 1.4
 * Mimari: Master Controller (Merkezi Kontrolcü) Yapısı
 *
 * Tüm değişken durumlar tek bir `state` nesnesinde toplanmıştır.
 * Böylece hangi değerin nerede değiştiği izlenebilir,
 * global scope kirlenmez ve ileride kolayca genişletilebilir.
 */
const state = {
    roomId: null,       // Aktif oda adı
    socket: null,       // Socket.IO bağlantısı
    isRemoteAction: false, // Sunucudan gelen komutların kendi event'lerimizi tetiklemesini önler
    video: null,        // Sayfadaki aktif <video> elementi
};

// --- 0. VISIBILITY BYPASS (Arka Plan Koruması) ---
// YouTube'un sekme değiştirildiğinde veya video sessizdeyken (muted) 
// videoyu durdurmasını engellemek için tarayıcıyı "görünür" olduğuna ikna eder.
function bypassVisibility() {
    // 1. Özellikleri Maskele: YouTube 'Gizli miyim?' diye sorduğunda 'Hayır' diyoruz.
    Object.defineProperty(document, 'hidden', { value: false, writable: false });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: false });
    Object.defineProperty(document, 'webkitHidden', { value: false, writable: false });

    // 2. Olayları Yakala ve Durdur: 'Sekme değişti' sinyalini YouTube'a ulaştırmıyoruz.
    const blockEvent = (e) => {
        // Sadece görünürlükle ilgili olayları durduruyoruz
        if (e.type === 'visibilitychange' || e.type === 'webkitvisibilitychange') {
            e.stopImmediatePropagation();
        }
    };

    document.addEventListener('visibilitychange', blockEvent, true);
    document.addEventListener('webkitvisibilitychange', blockEvent, true);
    
    console.log("🛡️ JamRoom: Visibility protection active.");
}

// --- 1. MASTER CONTROLLER (Merkezi Video Kontrolcüsü) ---
// Videoya dışarıdan (sunucudan) gelen her türlü müdahale (Play, Pause, Seek, Sync)
// tek bir merkezden geçer. Bu, kod tekrarını ve çakışmaları (overlap) önler.
function applyVideoAction(data) {
    if (!video) return;

    // Kendi yaptığımız işlemi sunucuya geri bildirmemek için kilidi açıyoruz.
    isRemoteAction = true;
    console.log(`🎬 Master Controller: ${data.type} uygulanıyor...`, data);

    // A. Zaman Güncelleme (Drift Correction)
    // Eğer gelen zaman ile bizim videomuz arasındaki fark 1.5 saniyeden büyükse eşitle.
    if (data.time !== undefined) {
        const threshold = 1.5; 
        if (Math.abs(video.currentTime - data.time) > threshold) {
            video.currentTime = data.time;
        }
    }

    // B. Oynatma/Durdurma Durumu (Muted & Background Fix)
    // Lider oynatıyorsa ve biz durmuşsak (veya tam tersi) durumu zorla eşitle.
    if (data.paused !== undefined) {
        if (data.paused && !video.paused) {
            video.pause();
        } else if (!data.paused && video.paused) {
            // Arka plandaki videoları uyandırmak için play() komutunu hata yakalayarak çalıştır.
            video.play().catch(e => console.warn("⚠️ Oynatma uyandırılamadı (User Interaction gerekli olabilir):", e));
        }
    }

    // İşlem tamamlandıktan 1 saniye sonra kilidi kapatarak manuel hareketlere izin ver.
    setTimeout(() => { isRemoteAction = false; }, 1000);
}

// --- 2. URL VE YÖNLENDİRME MERKEZİ ---
// Oda içinde video (URL) değiştiğinde veya yeni bir odaya girişteki 
// ağır senkronizasyon işlemlerini yönetir.
function handleServerAction(data) {
    isRemoteAction = true;
    
    if (data.type === 'URL_CHANGE' || data.type === 'SYNC') {
        const currentVideoId = getVideoId(location.href);
        const incomingVideoId = getVideoId(data.newUrl);

        // Eğer farklı bir videoya geçiliyorsa sayfayı yönlendir
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

    // Eğer video zaten aynıysa, sadece durum (Play/Pause) güncellemesi yap
    applyVideoAction({
        type: data.type,
        time: data.time,
        paused: (data.type === 'PAUSE' || (data.type === 'SYNC' && !data.state))
    });
}

// --- 3. BAĞLANTI VE DİNLEYİCİLER (CONNECT) ---
function connect(id) {
    if (socket) socket.disconnect(); 
    socket = io(CONFIG.SERVER_URL); 
    roomId = id;

    socket.on('connect', () => {
        console.log("✅ Connected to server. Room:", roomId);
        socket.emit('joinRoom', roomId);
        bypassVisibility(); 
    });

    // A. Heartbeat Mekanizması: Sunucu lidere (odadaki ilk kişi) zaman sorar
    socket.on('heartbeat_request', (data) => {
        if (video) {
            socket.emit('heartbeat_response', {
                roomId: data.roomId,
                time: video.currentTime,
                paused: video.paused
            });
        }
    });

    // B. Heartbeat Sync: Sunucudan gelen lider zamanını master controller'a ilet
    socket.on('heartbeat_sync', (data) => {
        applyVideoAction({ type: 'HEARTBEAT_SYNC', time: data.time, paused: data.paused });
    });

    // C. Manuel Eylemler: Diğer kullanıcıların Play/Pause/Seek hareketleri
    socket.on('videoActionFromServer', (data) => {
        if (data.type === 'URL_CHANGE') {
            handleServerAction(data);
        } else {
            applyVideoAction({ 
                type: data.type,
                time: data.time, 
                paused: (data.type === 'PAUSE' || (data.type === 'SYNC' && !data.state)) 
            });
        }
    });

    socket.on('userCountUpdate', (count) => {
        chrome.storage.local.set({ roomUserCount: count });
    });

    socket.on('getSyncData', (targetId) => {
        if (video) {
            socket.emit('sendSyncData', {
                targetId: targetId,
                action: { type: 'SYNC', newUrl: location.href, time: video.currentTime, state: !video.paused }
            });
        }
    });
}

// --- 4. YARDIMCI VE TAKİP FONKSİYONLARI ---

function applyPendingSync() {
    const pendingTime = sessionStorage.getItem('pendingSyncTime');
    const pendingState = sessionStorage.getItem('pendingSyncState');

    if (pendingTime && video) {
        video.onloadedmetadata = () => {
            isRemoteAction = true;
            video.currentTime = parseFloat(pendingTime);
            if (pendingState === 'true') video.play(); else video.pause();
            
            sessionStorage.removeItem('pendingSyncTime');
            sessionStorage.removeItem('pendingSyncState');
            setTimeout(() => { isRemoteAction = false; }, 1000);
        };
        if (video.readyState >= 1) video.onloadedmetadata();
    }
}

function getVideoId(url) {
    try { return new URL(url).searchParams.get("v"); } catch (e) { return null; }
}

function checkPageStatus() {
    if (!socket) return;
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
    v.onseeking = () => { if (!isRemoteAction && socket) socket.emit('videoAction', { type: 'SEEK', time: v.currentTime, roomId }); };
}

setInterval(checkPageStatus, 1000);

// --- 5. YOUTUBE NAVİGASYON VE POPUP SİNYALLERİ ---

window.addEventListener('yt-navigate-finish', () => {
    const isRemoteNav = sessionStorage.getItem('isRemoteNavigating');
    if (isRemoteNav === 'true') {
        sessionStorage.removeItem('isRemoteNavigating');
        return; 
    }
    if (!socket || isRemoteAction) return;
    
    const currentUrl = location.href;
    if (currentUrl.includes("watch?v=")) {
        const pureUrl = cleanYouTubeUrl(currentUrl); 
        if (currentUrl !== pureUrl) window.history.replaceState({}, '', pureUrl);

        socket.emit('videoAction', { type: 'URL_CHANGE', newUrl: pureUrl, roomId: roomId, time: 0, state: true });
        isRemoteAction = true;
        setTimeout(() => { isRemoteAction = false; }, 1000);
    }
});

chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "JOIN_NEW_ROOM") {
        sessionStorage.setItem('jamActive', 'true');
        connect(message.roomId);
        chrome.runtime.sendMessage({ type: "ROOM_JOINED", roomId: message.roomId });
    } else if (message.type === "LEAVE_ROOM") {
        if (socket) {
            socket.emit('leaveRoom', roomId);
            socket.disconnect();
            socket = null;
            roomId = null;
        }
        sessionStorage.removeItem('jamActive');
        chrome.runtime.sendMessage({ type: "SET_BADGE", text: "" });
    }
});

// Sayfa yenilendiğinde otomatik geri bağlanma
if (sessionStorage.getItem('jamActive') === 'true') {
    chrome.storage.local.get(['savedRoomId'], (res) => {
        if (res.savedRoomId) connect(res.savedRoomId);
    });
}

function cleanYouTubeUrl(rawUrl) {
    try {
        const urlObj = new URL(rawUrl);
        ['list', 'index', 'start_radio'].forEach(p => urlObj.searchParams.delete(p));
        return urlObj.toString();
    } catch (e) { return rawUrl; }
}