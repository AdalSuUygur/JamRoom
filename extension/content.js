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

// --- 0. REMOTE ACTION WRAPPER ---
// isRemoteAction flag'ini yöneten tek merkezi fonksiyon.
// Daha önce bu pattern 4 farklı yerde tekrarlanıyordu (DRY ihlali).
// handleServerAction'da ise false'a hiç dönülmüyordu — bu bir bug'dı.
// Tüm "uzaktan tetiklenen" işlemler bu wrapper üzerinden geçer.
function withRemoteAction(fn, delay = 1000) {
    state.isRemoteAction = true;
    fn();
    // Gecikme sonunda kilidi kaldır; bu sayede kullanıcı girişleri
    // tekrar işlenmeye başlar. Sabit 1sn çoğu durumda yeterlidir,
    // yavaş bağlantılar için caller delay'i artırabilir.
    setTimeout(() => { state.isRemoteAction = false; }, delay);
}

// --- 0b. VISIBILITY BYPASS (Arka Plan Koruması) ---
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
// isRemoteAction yönetimi artık withRemoteAction wrapper'ına devredildi.
function applyVideoAction(data) {
    if (!state.video) return;

    console.log(`🎬 Master Controller: ${data.type} uygulanıyor...`, data);

    // withRemoteAction: kilidi açar, işlemi çalıştırır, 1sn sonra kapatır.
    withRemoteAction(() => {

        // A. Zaman Güncelleme (Drift Correction)
        // Eğer gelen zaman ile bizim videomuz arasındaki fark 1.5 saniyeden büyükse eşitle.
        if (data.time !== undefined) {
            const threshold = 1.5;
            if (Math.abs(state.video.currentTime - data.time) > threshold) {
                state.video.currentTime = data.time;
            }
        }

        // B. Oynatma/Durdurma Durumu (Muted & Background Fix)
        // Lider oynatıyorsa ve biz durmuşsak (veya tam tersi) durumu zorla eşitle.
        if (data.paused !== undefined) {
            if (data.paused && !state.video.paused) {
                state.video.pause();
            } else if (!data.paused && state.video.paused) {
                // Arka plandaki videoları uyandırmak için play() komutunu
                // hata yakalayarak çalıştır (tarayıcı izni gerekmeyebilir).
                state.video.play().catch(e =>
                    console.warn("⚠️ Oynatma uyandırılamadı:", e)
                );
            }
        }

    });
}

// --- 2. URL VE YÖNLENDİRME MERKEZİ ---
// Oda içinde video (URL) değiştiğinde veya yeni bir odaya girişteki
// ağır senkronizasyon işlemlerini yönetir.
//
// Önceki yapıda isRemoteAction = true set ediliyordu ama false'a hiç
// dönülmüyordu — bu kullanıcı girişlerini kalıcı olarak bloke eden bir bug'dı.
// Şimdi her eylem tipi kendi handler'ına sahip, withRemoteAction üzerinden geçiyor.

function handleUrlChange(data) {
    const currentVideoId = getVideoId(location.href);
    const incomingVideoId = getVideoId(data.newUrl);

    // Farklı bir videoya geçiliyorsa sayfayı yönlendir.
    // URL_CHANGE'de pending sync gerekmez; video en baştan açılır.
    if (currentVideoId !== incomingVideoId) {
        sessionStorage.setItem('isRemoteNavigating', 'true');
        window.location.href = data.newUrl;
        return;
    }

    // Aynı video ise sadece play/pause durumunu güncelle.
    applyVideoAction({ type: data.type, time: data.time, paused: false });
}

function handleSync(data) {
    const currentVideoId = getVideoId(location.href);
    const incomingVideoId = getVideoId(data.newUrl);

    // Farklı video geliyorsa: sync bilgisini sessionStorage'a bırak,
    // sayfa yüklenince applyPendingSync() bunları uygular.
    if (currentVideoId !== incomingVideoId) {
        sessionStorage.setItem('pendingSyncTime', data.time);
        sessionStorage.setItem('pendingSyncState', data.state);
        sessionStorage.setItem('isRemoteNavigating', 'true');
        window.location.href = data.newUrl;
        return;
    }

    // Aynı video ise doğrudan uygula.
    applyVideoAction({
        type: data.type,
        time: data.time,
        paused: !data.state,
    });
}

// Her eylem tipini kendi handler'ına yönlendiren harita.
// Yeni bir tip eklemek için sadece buraya bir satır eklenir.
const SERVER_ACTION_HANDLERS = {
    URL_CHANGE: handleUrlChange,
    SYNC: handleSync,
};

function handleServerAction(data) {
    const handler = SERVER_ACTION_HANDLERS[data.type];

    if (handler) {
        // withRemoteAction: isRemoteAction'ı güvenli şekilde açıp kapatır.
        // Önceki bug: bu satır yoktu, flag hiç false'a dönmüyordu.
        withRemoteAction(() => handler(data));
    } else {
        // Bilinmeyen tipleri master controller'a düşür.
        applyVideoAction(data);
    }
}

// --- 3. BAĞLANTI VE DİNLEYİCİLER (CONNECT) ---
function connect(id) {
    // Varsa eski bağlantıyı temiz kapat; çift bağlantı olmasın.
    if (state.socket) state.socket.disconnect();

    state.socket = io(CONFIG.SERVER_URL);
    state.roomId = id;

    state.socket.on('connect', () => {
        console.log("✅ Connected to server. Room:", state.roomId);
        state.socket.emit('joinRoom', state.roomId);
        bypassVisibility();
    });

    // A. Heartbeat Mekanizması: Sunucu lidere (odadaki ilk kişi) zaman sorar.
    state.socket.on('heartbeat_request', (data) => {
        if (state.video) {
            state.socket.emit('heartbeat_response', {
                roomId: data.roomId,
                time: state.video.currentTime,
                paused: state.video.paused,
            });
        }
    });

    // B. Heartbeat Sync: Sunucudan gelen lider zamanını master controller'a ilet.
    state.socket.on('heartbeat_sync', (data) => {
        applyVideoAction({ type: 'HEARTBEAT_SYNC', time: data.time, paused: data.paused });
    });

    // C. Manuel Eylemler: Diğer kullanıcıların Play/Pause/Seek/URL hareketleri.
    // URL_CHANGE ve SYNC özel yönlendirme mantığı gerektirdiğinden handleServerAction'a,
    // diğerleri doğrudan master controller'a gönderilir.
    state.socket.on('videoActionFromServer', (data) => {
        if (data.type === 'URL_CHANGE' || data.type === 'SYNC') {
            handleServerAction(data);
        } else {
            applyVideoAction({
                type: data.type,
                time: data.time,
                paused: (data.type === 'PAUSE'),
            });
        }
    });

    // D. Kullanıcı sayısı güncellemesini storage'a yaz; popup buradan okur.
    state.socket.on('userCountUpdate', (count) => {
        chrome.storage.local.set({ roomUserCount: count });
    });

    // E. Odaya yeni biri girince lider güncel state'i gönderir.
    state.socket.on('getSyncData', (targetId) => {
        if (state.video) {
            state.socket.emit('sendSyncData', {
                targetId,
                action: {
                    type: 'SYNC',
                    newUrl: location.href,
                    time: state.video.currentTime,
                    state: !state.video.paused,
                },
            });
        }
    });
}

// --- 4. YARDIMCI VE TAKİP FONKSİYONLARI ---

// Sayfa yönlendirmesi (handleSync) sırasında sessionStorage'a bırakılan
// zaman ve oynatma durumunu yeni video yüklenince uygular.
function applyPendingSync() {
    const pendingTime = sessionStorage.getItem('pendingSyncTime');
    const pendingState = sessionStorage.getItem('pendingSyncState');

    if (!pendingTime || !state.video) return;

    const apply = () => {
        // withRemoteAction: sync sırasında kendi event'lerimizin sunucuya
        // gitmesini engeller.
        withRemoteAction(() => {
            state.video.currentTime = parseFloat(pendingTime);
            if (pendingState === 'true') state.video.play();
            else state.video.pause();
        });

        sessionStorage.removeItem('pendingSyncTime');
        sessionStorage.removeItem('pendingSyncState');
    };

    // Video metadata henüz yüklenmediyse hazır olunca uygula,
    // yüklendiyse (readyState >= 1) hemen uygula.
    if (state.video.readyState >= 1) {
        apply();
    } else {
        state.video.onloadedmetadata = apply;
    }
}

function getVideoId(url) {
    try { return new URL(url).searchParams.get("v"); } catch (e) { return null; }
}

// Eski video elementindeki event listener'ları temizler.
// attachEvents her çağrıldığında önce bu çalışır; böylece memory leak önlenir.
function detachEvents(v) {
    if (!v) return;
    v.onplay = null;
    v.onpause = null;
    v.onseeking = null;
}

// Yeni video elementine play/pause/seek dinleyicilerini bağlar.
// Kullanıcı kaynaklı hareketleri sunucuya iletir; remote action sırasında sessiz kalır.
function attachEvents(v) {
    detachEvents(state.video); // Önce eskisini temizle

    v.onplay    = () => { if (!state.isRemoteAction && state.socket) state.socket.emit('videoAction', { type: 'PLAY',  roomId: state.roomId }); };
    v.onpause   = () => { if (!state.isRemoteAction && state.socket) state.socket.emit('videoAction', { type: 'PAUSE', roomId: state.roomId }); };
    v.onseeking = () => { if (!state.isRemoteAction && state.socket) state.socket.emit('videoAction', { type: 'SEEK',  time: v.currentTime, roomId: state.roomId }); };
}

// --- 4b. VIDEO ELEMENTİ TAKİBİ (MutationObserver) ---
// YouTube bir SPA (Single Page Application) olduğundan video elementi
// sayfa yenilenmeden değişebilir. Önceki yaklaşım setInterval ile her saniye
// DOM'u tarıyordu — bu gereksiz CPU tüketir.
// MutationObserver yalnızca DOM değiştiğinde tetiklenir: daha verimli ve hızlı.
const videoObserver = new MutationObserver(() => {
    if (!state.socket) return;

    const v = document.querySelector('video');
    if (v && v !== state.video) {
        state.video = v;
        attachEvents(v);
        applyPendingSync();
    }
});

// body'nin tüm alt ağacını izle; YouTube lazy-load ile video ekleyebilir.
videoObserver.observe(document.body, { childList: true, subtree: true });

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