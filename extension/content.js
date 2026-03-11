
// JAMROOM CONTENT SCRIPT - Version 2.0

// Chrome exposes `chrome.*`; Firefox exposes `browser.*`. Both work with `ext`.
const ext = typeof browser !== 'undefined' ? browser : chrome;
const state = {
    roomId:         null,  // Active room name
    socket:         null,  // Socket.IO connection
    isRemoteAction: false, // Prevents server-driven events from echoing back
    video:          null,  // Active <video> element on the page
    nickname:       null,  // Cached so reconnect can re-join without re-reading
};

// --- 0. USERNAME COLLECTION ---
// username-reader.js runs in the MAIN world and reads window.yt, then relays the value here via postMessage.
// If no message arrives within 2 s we proceed with null — the server will assign "Guest N" automatically.
const usernamePromise = new Promise((resolve) => {
    function onMessage(event) {
        if (event.source !== window) return;
        if (event.data?.type !== 'JAMROOM_USERNAME') return;
        window.removeEventListener('message', onMessage);
        resolve(event.data.username || null);
    }
    window.addEventListener('message', onMessage);
    setTimeout(() => resolve(null), 2000);
});

// --- 0b. REMOTE ACTION WRAPPER ---
function withRemoteAction(fn, delay = 1000) {
    state.isRemoteAction = true;
    fn();
    setTimeout(() => { state.isRemoteAction = false; }, delay);
}

// --- 0c. VISIBILITY BYPASS (Background Tab Protection) ---
// Tricks the browser into believing the tab is always visible so YouTube does not pause a muted video when the tab loses focus.
function bypassVisibility() {
    // 1. Mask visibility properties so YouTube always sees "visible".
    Object.defineProperty(document, 'hidden',          { value: false,     writable: false });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: false });
    Object.defineProperty(document, 'webkitHidden',    { value: false,     writable: false });

    // 2. Intercept visibility events before YouTube can react.
    const blockEvent = (e) => {
        if (e.type !== 'visibilitychange' && e.type !== 'webkitvisibilitychange') return;

        // Muted Video Watcher:
        //   - onpause filter  → prevents a false PAUSE signal from reaching the room.
        //   - This watcher   → keeps the local video playing.
        const v = state.video;
        if (v && v.muted && state.socket) {
            setTimeout(() => {
                if (v.paused && v.muted) {
                    v.play().catch(() => {
                        // Autoplay may be blocked in the background;
                        // the next heartbeat will re-sync the timestamp.
                    });
                }
            }, 300);
        }

        e.stopImmediatePropagation();
    };

    document.addEventListener('visibilitychange',       blockEvent, true);
    document.addEventListener('webkitvisibilitychange', blockEvent, true);

    console.log('[JamRoom] Visibility protection active.');
}

// --- 1. MASTER CONTROLLER ---
// Every server-driven video mutation (Play, Pause, Seek, Sync, Heartbeat) flows through this single function.
// Centralising here eliminates overlap and duplicated logic.
function applyVideoAction(data) {
    if (!state.video) return;

    console.log(`[JamRoom] Applying action: ${data.type}`, data);

    withRemoteAction(() => {

        // A. Drift Correction
        // Seek only when the difference exceeds the threshold to avoid unnecessary interruptions for minor drift.
        if (data.time !== undefined) {
            const DRIFT_THRESHOLD_SEC = 1.5;
            if (Math.abs(state.video.currentTime - data.time) > DRIFT_THRESHOLD_SEC) {
                state.video.currentTime = data.time;
            }
        }

        // B. Play / Pause State (handles muted & background cases)
        // Force-align our playback state with the leader's state.
        if (data.paused !== undefined) {
            if (data.paused && !state.video.paused) {
                state.video.pause();
            } else if (!data.paused && state.video.paused) {
                state.video.play().catch((e) =>
                    console.warn('[JamRoom] Could not resume playback:', e)
                );
            }
        }

    });
}

// --- 2. URL & NAVIGATION HANDLERS ---
// Manages heavy sync operations when a video or room changes.
function handleUrlChange(data) {
    const currentVideoId  = getVideoId(location.href);
    const incomingVideoId = getVideoId(data.newUrl);

    if (currentVideoId !== incomingVideoId) {
        // Different video → navigate. No pending sync needed;
        sessionStorage.setItem('isRemoteNavigating', 'true');
        window.location.href = data.newUrl;
        return;
    }

    // Same video → only update play/pause state.
    applyVideoAction({ type: data.type, time: data.time, paused: false });
}

function handleSync(data) {
    const currentVideoId  = getVideoId(location.href);
    const incomingVideoId = getVideoId(data.newUrl);

    if (currentVideoId !== incomingVideoId) {
        // Different video → stash sync data before navigating.
        // applyPendingSync() will apply it once the new page loads.
        sessionStorage.setItem('pendingSyncTime',    data.time);
        sessionStorage.setItem('pendingSyncState',   data.state);
        sessionStorage.setItem('isRemoteNavigating', 'true');
        window.location.href = data.newUrl;
        return;
    }

    // Same video → apply immediately.
    applyVideoAction({
        type:   data.type,
        time:   data.time,
        paused: !data.state,
    });
}

// Dispatch table: adding a new action type requires only one line here.
const SERVER_ACTION_HANDLERS = {
    URL_CHANGE: handleUrlChange,
    SYNC:       handleSync,
};

function handleServerAction(data) {
    const handler = SERVER_ACTION_HANDLERS[data.type];

    if (handler) {
        withRemoteAction(() => handler(data));
    } else {
        // Unknown types fall through to the master controller.
        applyVideoAction(data);
    }
}

// --- 3. CONNECTION & EVENT LISTENERS ---
async function connect(id) {
    // Tear down any existing connection to prevent duplicates.
    if (state.socket) state.socket.disconnect();
    state.nickname = await usernamePromise;
    console.log('[JamRoom] Connecting as:', state.nickname ?? 'Guest');

    state.socket = io(CONFIG.SERVER_URL);
    state.roomId = id;

    // ─── FIRST CONNECTION ────────────────────────────────────────────────
    // `connect` fires once on initial connection.
    state.socket.on('connect', () => {
        console.log('[JamRoom] Connected. Room:', state.roomId);
        state.socket.emit('joinRoom', { roomId: state.roomId, nickname: state.nickname });
        bypassVisibility();
    });

    // ─── AUTO-RECONNECT RECOVERY ─────────────────────────────────────────
    // Socket.IO reconnects the transport automatically when the network recovers. 
    // However, the server has already evicted this client from its room on `disconnect`, so we must re-emit `joinRoom` to get back in.
    // Why NOT use `connect` for this? `connect` fires on both the initial connection AND every reconnection.
    state.socket.on('reconnect', (attemptNumber) => {
        console.log(`[JamRoom] Reconnected after ${attemptNumber} attempt(s). Re-joining room...`);

        // Read the authoritative roomId from storage instead of trusting
        // in-memory state which may have been cleared during the outage.
        ext.storage.local.get(['savedRoomId'], (res) => {
            const roomId = res.savedRoomId || state.roomId;
            if (!roomId) {
                console.warn('[JamRoom] Reconnected but no savedRoomId found. Cannot re-join.');
                return;
            }

            // Keep state in sync with storage's ground truth.
            state.roomId = roomId;

            state.socket.emit('joinRoom', { roomId, nickname: state.nickname });
            console.log('[JamRoom] Re-emitted joinRoom for room:', roomId);

            // Restore the badge so the user sees "ON" again.
            ext.runtime.sendMessage({
                type:  'SET_BADGE',
                text:  'ON',
                color: '#00FF00',
            });
        });
    });


    // ─── DISCONNECT FEEDBACK ─────────────────────────────────────────────
    // Inform the user when the connection drops so they know a reconnect attempt is in progress. 
    // The badge turns yellow ("...") during the outage and reverts to green ("ON") in the `reconnect` handler above.
    state.socket.on('disconnect', (reason) => {
        const intentional = reason === 'io client disconnect';
        console.log(`[JamRoom] Disconnected. Reason: ${reason}. Intentional: ${intentional}`);

        if (!intentional) {
            // Temporary network drop — signal the user that recovery is underway.
            ext.runtime.sendMessage({
                type:  'SET_BADGE',
                text:  '...',
                color: '#FFA500', // Orange = reconnecting
            });
        }
    });

    // A. Heartbeat request — server asks the leader for the current timestamp.
    state.socket.on('heartbeat_request', (data) => {
        if (state.video) {
            state.socket.emit('heartbeat_response', {
                roomId: data.roomId,
                time:   state.video.currentTime,
                paused: state.video.paused,
            });
        }
    });

    // B. Heartbeat sync — broadcast the leader's timestamp to all followers.
    state.socket.on('heartbeat_sync', (data) => {
        applyVideoAction({ type: 'HEARTBEAT_SYNC', time: data.time, paused: data.paused });
    });

    // C. Manual actions from other users (Play / Pause / Seek / URL change).
    // URL_CHANGE and SYNC need navigation logic; everything else goes straight to the master controller.
    state.socket.on('videoActionFromServer', (data) => {
        if (data.type === 'URL_CHANGE' || data.type === 'SYNC') {
            handleServerAction(data);
        } else {
            applyVideoAction({
                type:   data.type,
                time:   data.time,
                paused: (data.type === 'PAUSE'),
            });
        }
    });

    // D. User count update — written to storage; popup reads from there.
    state.socket.on('userCountUpdate', (count) => {
        ext.storage.local.set({ roomUserCount: count });
    });

    // D2. Full nickname list — emitted on every join / leave / disconnect.
    state.socket.on('userListUpdate', (list) => {
        ext.storage.local.set({ roomUserList: list });
    });

    // D3. Queue update — server broadcasts the full queue on every mutation.
    state.socket.on('queueUpdate', (queue) => {
        ext.storage.local.set({ roomQueue: queue });
    });

    // E. New participant joined — leader sends current state to them.
    state.socket.on('getSyncData', (targetId) => {
        if (state.video) {
            state.socket.emit('sendSyncData', {
                targetId,
                action: {
                    type:   'SYNC',
                    newUrl: location.href,
                    time:   state.video.currentTime,
                    state:  !state.video.paused,
                },
            });
        }
    });
}

// --- 4. HELPERS & VIDEO TRACKING ---
// Applies a stashed sync (time + play state) after a cross-video navigation.
function applyPendingSync() {
    const pendingTime  = sessionStorage.getItem('pendingSyncTime');
    const pendingState = sessionStorage.getItem('pendingSyncState');

    if (!pendingTime || !state.video) return;

    const apply = () => {
        // withRemoteAction prevents our own seek/play events from echoing back to the room during the sync window.
        withRemoteAction(() => {
            state.video.currentTime = parseFloat(pendingTime);
            if (pendingState === 'true') state.video.play();
            else                         state.video.pause();
        });

        sessionStorage.removeItem('pendingSyncTime');
        sessionStorage.removeItem('pendingSyncState');
    };

    // Apply immediately if metadata is already loaded (readyState ≥ 1), otherwise wait for the loadedmetadata event.
    if (state.video.readyState >= 1) {
        apply();
    } else {
        state.video.onloadedmetadata = apply;
    }
}

function getVideoId(url) {
    try { return new URL(url).searchParams.get('v'); } catch { return null; }
}

// Removes event listeners from the previous video element to prevent memory leaks. Called at the top of attachEvents on every video switch.
function detachEvents(v) {
    if (!v) return;
    v.onplay    = null;
    v.onpause   = null;
    v.onseeking = null;
    v.onended   = null;  // Clean up queue auto-advance listener on video switch.
}

// Attaches play / pause / seek listeners to a new video element.
// User-originated events are forwarded to the server;
// server-driven events are silenced via isRemoteAction.
function attachEvents(v) {
    detachEvents(state.video); // Clean up the previous element first.

    v.onplay = () => {
        if (!state.isRemoteAction && state.socket) {
            state.socket.emit('videoAction', { type: 'PLAY', roomId: state.roomId });
        }
    };

    v.onpause = () => {
        // MUTED PAUSE FILTER:
        // Chrome auto-pauses muted videos when a tab is backgrounded.
        if (v.muted) return;

        if (!state.isRemoteAction && state.socket) {
            state.socket.emit('videoAction', { type: 'PAUSE', roomId: state.roomId });
        }
    };

    v.onseeking = () => {
        if (!state.isRemoteAction && state.socket) {
            state.socket.emit('videoAction', { type: 'SEEK', time: v.currentTime, roomId: state.roomId });
        }
    };

    // QUEUE AUTO-ADVANCE:
    // When the current video ends, emit `queueNext` so the server can pop the head of the queue and broadcast a URL_CHANGE to the whole room.
    // "Leader" heuristic: the client that joined earliest is at index 0 in the server's room set.
    v.onended = () => {
        if (!state.socket || !state.roomId) return;
        state.socket.emit('queueNext', {
            roomId:     state.roomId,
            currentUrl: cleanYouTubeUrl(location.href),
        });
    };
}


// --- 4b. VIDEO ELEMENT TRACKING (MutationObserver) ---
// YouTube is a SPA — the <video> element can be replaced without a full page reload. A setInterval approach wastes CPU by scanning every second.
const videoObserver = new MutationObserver(() => {
    if (!state.socket) return;

    const v = document.querySelector('video');
    if (v && v !== state.video) {
        state.video = v;
        attachEvents(v);
        applyPendingSync();
    }
});

// Observe the full subtree; YouTube lazy-loads the video element.
videoObserver.observe(document.body, { childList: true, subtree: true });

// ── YOUTUBE NAVIGATION DETECTION ────────────────────────────────────────────
let _lastUrl = location.href;

function handleNavigation() {
    const isRemoteNav = sessionStorage.getItem('isRemoteNavigating');
    if (isRemoteNav === 'true') {
        sessionStorage.removeItem('isRemoteNavigating');
        return;
    }

    if (!state.socket || state.isRemoteAction) return;

    const currentUrl = location.href;
    if (!currentUrl.includes('watch?v=')) return;
    if (currentUrl === _lastUrl) return;  // guard: no duplicate emits
    _lastUrl = currentUrl;

    const pureUrl = cleanYouTubeUrl(currentUrl);
    if (currentUrl !== pureUrl) window.history.replaceState({}, '', pureUrl);

    withRemoteAction(() => {
        state.socket.emit('videoAction', {
            type:   'URL_CHANGE',
            newUrl: pureUrl,
            roomId: state.roomId,
            time:   0,
            state:  true,
        });
    });
}

// 1. Primary — Chrome & Firefox 128+ with YouTube's custom event
window.addEventListener('yt-navigate-finish', handleNavigation);

// 2. Back / forward navigation
window.addEventListener('popstate', handleNavigation);

// 3. pushState fallback — YouTube's main navigation mechanism.
//    _lastUrl guard makes this a no-op when URL hasn't changed.
setInterval(() => { if (state.socket) handleNavigation(); }, 1000);


// Listens for JOIN / LEAVE / QUEUE commands sent from the popup.
ext.runtime.onMessage.addListener((message) => {
    if (message.type === 'JOIN_NEW_ROOM') {
        sessionStorage.setItem('jamActive', 'true');
        connect(message.roomId);
        ext.runtime.sendMessage({ type: 'ROOM_JOINED', roomId: message.roomId });

    } else if (message.type === 'LEAVE_ROOM') {
        if (state.socket) {
            state.socket.emit('leaveRoom', state.roomId);
            state.socket.disconnect();
            state.socket = null;
            state.roomId = null;
        }
        sessionStorage.removeItem('jamActive');
        // Ask background.js to clear the badge on this tab.
        ext.runtime.sendMessage({ type: 'SET_BADGE', text: '' });

    // ── QUEUE: ADD ───────────────────────────────────────────────────────────
    } else if (message.type === 'QUEUE_ADD') {
        if (state.socket) {
            state.socket.emit('queueAdd', {
                roomId:  message.roomId,
                url:     message.url,
                title:   message.title,
                addedBy: message.addedBy,
            });
        }

    // ── QUEUE: REMOVE ────────────────────────────────────────────────────────
    } else if (message.type === 'QUEUE_REMOVE') {
        if (state.socket) {
            state.socket.emit('queueRemove', {
                roomId: message.roomId,
                index:  message.index,
            });
        }
    }
});

// Session recovery on page reload (F5).
// If jamActive is set and a savedRoomId exists, reconnect automatically.
if (sessionStorage.getItem('jamActive') === 'true') {
    ext.storage.local.get(['savedRoomId'], (res) => {
        if (res.savedRoomId) connect(res.savedRoomId);
    });
}

// Removes YouTube playlist parameters from a URL so all participants
function cleanYouTubeUrl(rawUrl) {
    try {
        const urlObj = new URL(rawUrl);
        ['list', 'index', 'start_radio'].forEach(p => urlObj.searchParams.delete(p));
        return urlObj.toString();
    } catch { return rawUrl; }
}