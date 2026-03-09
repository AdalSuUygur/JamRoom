// -------------------------------------------
// JamRoom - content.js
// -------------------------------------------

let roomId = null; 
let socket = null;
let isRemoteAction = false; 
let video = null; 
let currentUrl = location.href;

// 1. BAĞLANTI FONKSİYONU
function connect(id) {
    if (socket) socket.disconnect(); 
    
    socket = io(CONFIG.API_URL); 
    roomId = id;

    socket.on('connect', () => {
        console.log("✅ Connected to server. Room:", roomId);
        socket.emit('joinRoom', roomId);
    });
    
    // [FIREFOX PORT DETAYI]: Local storage'a veri yazılırken browser.storage objesi kullanılıyor.
    socket.on('userCountUpdate', (count) => {
        browser.storage.local.set({ roomUserCount: count });
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
        
        video.onloadedmetadata = () => {
            isRemoteAction = true;
            video.currentTime = parseFloat(pendingTime);
            
            if (pendingState === 'true') video.play(); else video.pause();
            
            sessionStorage.removeItem('pendingSyncTime');
            sessionStorage.removeItem('pendingSyncState');
            
            setTimeout(() => { isRemoteAction = false; }, 1000);
        };

        if (video.readyState >= 1) {
            video.onloadedmetadata();
        }
    }
}

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

    // Uzaktan gelen komutun yankı yapmaması için ufak bir bekleme süresi
    setTimeout(() => { isRemoteAction = false; }, 1000);
}

// 4. SAYFA VE VİDEO TAKİBİ
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
    v.onseeking = () => { 
        if (!isRemoteAction && socket) {
            socket.emit('videoAction', { type: 'SEEK', time: v.currentTime, roomId });
        }
    };
}

setInterval(checkPageStatus, 1000);

// --- YOUTUBE SENSÖRÜ ---
// YouTube bir SPA (Single Page Application) olduğu için normal yönlendirmeler yerine bu eventi dinliyoruz.
window.addEventListener('yt-navigate-finish', () => {
    const isRemoteNav = sessionStorage.getItem('isRemoteNavigating');
    if (isRemoteNav === 'true') {
        sessionStorage.removeItem('isRemoteNavigating');
        console.log("🤫 Navigated due to a server action; suppressing echo feedback.");
        return; 
    }

    if (!socket || isRemoteAction) return;
    
    const currentUrl = location.href;
    
    if (currentUrl.includes("watch?v=")) {
        const pureUrl = cleanYouTubeUrl(currentUrl); 

        // URL'yi gereksiz parametrelerden arındırma (Örn: Playlist id'leri)
        if (currentUrl !== pureUrl) {
            console.log("🧹 Cleaning playlist parameters from the current URL...");
            window.history.replaceState({}, '', pureUrl);
        }

        console.log("🔗 Sending cleaned URL to the room:", pureUrl);
        socket.emit('videoAction', { type: 'URL_CHANGE', newUrl: pureUrl, roomId });
        
        isRemoteAction = true;
        setTimeout(() => { isRemoteAction = false; }, 900);
    }
});

// 5. POPUP'TAN GELEN MESAJLAR
browser.runtime.onMessage.addListener((message) => {
    if (message.type === "JOIN_NEW_ROOM") {
        sessionStorage.setItem('jamActive', 'true');
        connect(message.roomId);

        browser.runtime.sendMessage({
            type: "ROOM_JOINED",
            roomId: message.roomId
        });
    }
    else if (message.type === "LEAVE_ROOM") {
        if (socket) {
            socket.emit('leaveRoom', roomId);
            socket.disconnect();
            socket = null;
            roomId = null;
        }
        sessionStorage.removeItem('jamActive');
        browser.runtime.sendMessage({ type: "SET_BADGE", text: "" });
        console.log("✅ JamRoom: Left the room and disconnected.");
    }
});

// Sayfa yenilendiğinde (veya yeni müziğe geçildiğinde) kopmamak için bağlantı kontrolü:
if (sessionStorage.getItem('jamActive') === 'true') {
    // [FIREFOX PORT DETAYI]: Storage okuma işlemi callback yerine Promise (.then) ile yapıldı.
    browser.storage.local.get(['savedRoomId']).then((res) => {
        if (res.savedRoomId) {
            connect(res.savedRoomId); 
            browser.runtime.sendMessage({ type: "SET_BADGE", text: "ON", color: "#00FF00" });
        }
    });
} else {
    browser.runtime.sendMessage({ type: "SET_BADGE", text: "", color: "#00FF00" });
}

function cleanYouTubeUrl(rawUrl) {
    try {
        const urlObj = new URL(rawUrl);
        urlObj.searchParams.delete('list');
        urlObj.searchParams.delete('index');
        urlObj.searchParams.delete('start_radio');
        return urlObj.toString();
    } catch (e) {
        return rawUrl; 
    }
}