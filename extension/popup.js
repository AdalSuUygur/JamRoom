
// JamRoom — popup.js  (v2)

const ext = typeof browser !== 'undefined' ? browser : chrome;
const countDisplay = document.getElementById('countDisplay');
const roomInput    = document.getElementById('roomInput');
const copyBtn      = document.getElementById('copyBtn');
const toast        = document.getElementById('toast');
const queueInput   = document.getElementById('queueInput');
const queueAddBtn  = document.getElementById('queueAddBtn');
const queueList    = document.getElementById('queueList');
const queueMeta    = document.getElementById('queueMeta');
const queueLocked  = document.getElementById('queueLocked');
const queueActive  = document.getElementById('queueActive');

// ── STATE ────────────────────────────────────────────────────────────────────
// Single mutable object so every reader sees the same truth.
const state = {
  inRoom:   false,  // whether the user is currently in a room
  nickname: null,   // resolved nickname (from storage or server echo)
};

// ── TAB SWITCHING ────────────────────────────────────────────────────────────
// Tab buttons carry [data-tab] attributes that match panel IDs.
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));

    btn.classList.add('active');
    document.getElementById(`panel-${target}`).classList.add('active');
  });
});

// ── applyI18n ────────────────────────────────────────────────────────────────
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const msg = ext.i18n.getMessage(el.dataset.i18n);
    if (msg) el.textContent = msg;
  });
}

// ── setStatus ────────────────────────────────────────────────────────────────
function setStatus(text, isInRoom = false) {
  if (!countDisplay) return;
  countDisplay.innerText = text;
  countDisplay.classList.toggle('in-room', isInRoom);
}

// ── isYouTubeTab ─────────────────────────────────────────────────────────────
// Extracted predicate — used by joinBtn and leaveBtn.
function isYouTubeTab(tab) {
  return Boolean(tab?.url?.includes('youtube.com'));
}

// ── updateCopyVisibility ─────────────────────────────────────────────────────
// Copy button is only meaningful when in an active room.
function updateCopyVisibility(show) {
  copyBtn.style.display = show ? 'block' : 'none';
}

// ── updateQueueVisibility ────────────────────────────────────────────────────
// Swaps between the "locked" placeholder and the active queue UI.
function updateQueueVisibility(show) {
  queueLocked.style.display  = show ? 'none'  : 'block';
  queueActive.style.display  = show ? 'block' : 'none';
}

// ── TOAST ────────────────────────────────────────────────────────────────────
let toastTimer = null;

function showToast(message, duration = 2000) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ── COPY ROOM NAME ───────────────────────────────────────────────────────────
// Uses roomInput.value as the single source of truth — no duplicate state.
let copyResetTimer = null;

copyBtn.addEventListener('click', () => {
  const roomId = roomInput.value.trim();
  if (!roomId) return;

  navigator.clipboard.writeText(roomId).then(() => {
    copyBtn.textContent = '\u2713';            // ✓
    copyBtn.classList.add('btn--copied');

    showToast(ext.i18n.getMessage('shareCopied') + ' \u2014 ' + roomId);

    clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      copyBtn.textContent = '\uD83D\uDCCB';   // 📋
      copyBtn.classList.remove('btn--copied');
    }, 2000);
  }).catch(() => {
    // Clipboard can fail if popup loses focus mid-click; silently ignore.
  });
});

// ── JOIN ─────────────────────────────────────────────────────────────────────
document.getElementById('joinBtn').addEventListener('click', () => {
  const roomId = roomInput.value.trim();

  if (!roomId) {
    setStatus(ext.i18n.getMessage('errorEnterRoomName'));
    return;
  }

  ext.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!isYouTubeTab(tabs[0])) {
      setStatus(ext.i18n.getMessage('errorOpenYouTubeJoin'));
      return;
    }

    ext.storage.local.set({ savedRoomId: roomId }, () => {
      sendMessageToContent('JOIN_NEW_ROOM', roomId);
      setStatus(ext.i18n.getMessage('statusJoining', [roomId]));
    });
  });
});

// ── LEAVE ────────────────────────────────────────────────────────────────────
document.getElementById('leaveBtn').addEventListener('click', () => {
  ext.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!isYouTubeTab(tabs[0])) {
      setStatus(ext.i18n.getMessage('errorOpenYouTubeLeave'));
      return;
    }

    sendMessageToContent('LEAVE_ROOM', null);
    ext.storage.local.remove(['savedRoomId', 'roomUserCount', 'roomUserList', 'roomQueue']);
    setStatus(ext.i18n.getMessage('statusDefault'), false);
    updateCopyVisibility(false);
    updateQueueVisibility(false);
    renderQueue([]);
    state.inRoom = false;
  });
});

// ── sendMessageToContent ─────────────────────────────────────────────────────
// Single function for all content-script messages — badge management lives here
// because the popup already has the active tab reference (avoids round-trip).
function sendMessageToContent(type, data) {
  ext.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    ext.tabs.sendMessage(tabs[0].id, { type, roomId: data });

    if (type === 'JOIN_NEW_ROOM') {
      ext.action.setBadgeText({ text: 'ON', tabId: tabs[0].id });
      ext.action.setBadgeBackgroundColor({ color: '#00FF00', tabId: tabs[0].id });
      ext.runtime.sendMessage({ type: 'SET_ACTIVE_TAB', tabId: tabs[0].id });
    } else if (type === 'LEAVE_ROOM') {
      ext.action.setBadgeText({ text: '', tabId: tabs[0].id });
    }
  });
}

// ── INCOMING MESSAGES (from content.js) ─────────────────────────────────────
ext.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'ROOM_JOINED') return;

  if (msg.roomId) roomInput.value = msg.roomId;
  state.inRoom = true;
  setStatus(ext.i18n.getMessage('statusJoined', [msg.roomId]), true);
  updateCopyVisibility(true);
  updateQueueVisibility(true);

  // Wait briefly for first server push (userListUpdate + queueUpdate).
  setTimeout(() => {
    ext.storage.local.get(['roomUserCount', 'roomUserList', 'roomQueue'], (res) => {
      const count = res.roomUserCount || 1;
      setStatus(ext.i18n.getMessage('statusInRoom', [String(count)]), true);
      renderMemberList(res.roomUserList || []);
      renderQueue(res.roomQueue || []);
    });
  }, 1200);
});

// ── STORAGE LISTENER (real-time while popup is open) ────────────────────────
ext.storage.onChanged.addListener((changes) => {
  if (changes.roomUserList) {
    renderMemberList(changes.roomUserList.newValue || []);
  }

  if (changes.roomUserCount) {
    const count = changes.roomUserCount.newValue || 0;
    const key   = count === 0 ? 'statusDefault' : 'statusInRoom';
    const args  = count === 0 ? []              : [String(count)];
    setStatus(ext.i18n.getMessage(key, args), count > 0);
  }

  if (changes.roomQueue) {
    renderQueue(changes.roomQueue.newValue || []);
  }
});

// ── SESSION RESTORE ──────────────────────────────────────────────────────────
// Runs on every popup open — restores UI to match persisted state.
ext.storage.local.get(['savedRoomId', 'roomUserCount', 'roomUserList', 'roomQueue', 'savedNickname'], (result) => {
  if (result.savedNickname) state.nickname = result.savedNickname;

  if (result.savedRoomId) {
    roomInput.value = result.savedRoomId;
    state.inRoom    = true;

    const count = result.roomUserCount || 1;
    setStatus(ext.i18n.getMessage('statusInRoom', [String(count)]), true);
    renderMemberList(result.roomUserList || []);
    renderQueue(result.roomQueue || []);
    updateCopyVisibility(true);
    updateQueueVisibility(true);
  } else {
    roomInput.value = '';
    setStatus(ext.i18n.getMessage('statusDefault'), false);
    renderMemberList([]);
    renderQueue([]);
    updateCopyVisibility(false);
    updateQueueVisibility(false);
  }
});

// ── renderMemberList ─────────────────────────────────────────────────────────
// Maps a nickname array to member-item divs.
// Unicode escape for 👤 keeps the file pure ASCII (avoids encoding issues).
function renderMemberList(list) {
  const container = document.getElementById('memberList');
  if (!container) return;

  container.innerHTML = (list?.length)
    ? list.map(name => `<div class="member-item">\u{1F464} ${escapeHtml(name)}</div>`).join('')
    : '';
}

// ── QUEUE: ADD ───────────────────────────────────────────────────────────────
// User pastes a YouTube URL → we extract the video ID, fetch the title via YouTube's free oEmbed endpoint (no API key required), then emit queueAdd.
queueAddBtn.addEventListener('click', addToQueue);

queueInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addToQueue();
});

async function addToQueue() {
  const raw = queueInput.value.trim();
  if (!raw) return;

  const videoId = extractVideoId(raw);
  if (!videoId) {
    showToast(ext.i18n.getMessage('queueInvalidUrl'));
    return;
  }

  const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;

  queueAddBtn.disabled = true;
  queueAddBtn.textContent = '…';

  // Resolve human-readable title via oEmbed (no API key needed).
  // Falls back gracefully to the video ID string on any network error.
  const title = await fetchVideoTitle(cleanUrl);

  ext.storage.local.get(['savedRoomId', 'savedNickname'], (res) => {
    if (!res.savedRoomId) {
      showToast(ext.i18n.getMessage('queueLockedMsg'));
      resetAddBtn();
      return;
    }

    // Forward the add request to content.js which has the live socket.
    ext.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) { resetAddBtn(); return; }

      ext.tabs.sendMessage(tabs[0].id, {
        type:    'QUEUE_ADD',
        roomId:  res.savedRoomId,
        url:     cleanUrl,
        title,
        addedBy: res.savedNickname || 'You',
      });

      queueInput.value = '';
      resetAddBtn();
      showToast(ext.i18n.getMessage('queueAdded'));
    });
  });
}

function resetAddBtn() {
  queueAddBtn.disabled    = false;
  queueAddBtn.textContent = '+';
}

// Extracts the `v` parameter from any YouTube URL format.
// Returns null for non-YouTube or invalid URLs.
function extractVideoId(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    return u.searchParams.get('v') || null;
  } catch {
    return null;
  }
}

// Fetches the video title from YouTube's oEmbed API.
// No API key, no quota. Returns the raw URL as fallback.
async function fetchVideoTitle(url) {
  try {
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res  = await fetch(endpoint);
    const data = await res.json();
    return data.title || url;
  } catch {
    return url;
  }
}

// ── QUEUE: REMOVE ────────────────────────────────────────────────────────────
// Delegated listener on the container — handles dynamically added rows.
queueList.addEventListener('click', (e) => {
  const btn = e.target.closest('.queue-remove');
  if (!btn) return;

  const index = parseInt(btn.dataset.index, 10);
  if (isNaN(index)) return;

  ext.storage.local.get(['savedRoomId'], (res) => {
    if (!res.savedRoomId) return;

    ext.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      ext.tabs.sendMessage(tabs[0].id, {
        type:   'QUEUE_REMOVE',
        roomId: res.savedRoomId,
        index,
      });
    });
  });
});

// ── renderQueue ──────────────────────────────────────────────────────────────
// Renders the queue array into #queueList.
// Index 0 is the "now playing" item (green blinking dot via CSS :first-child).
// Each item carries [data-index] so the remove handler can find it.
function renderQueue(queue) {
  if (!queue?.length) {
    queueMeta.textContent = '';
    queueList.innerHTML   = `<div class="queue-empty">${ext.i18n.getMessage('queueEmpty')}</div>`;
    return;
  }

  const total = queue.length;
  queueMeta.innerHTML = `<span>${total}</span> ${ext.i18n.getMessage(total === 1 ? 'queueCountOne' : 'queueCountMany')}`;

  queueList.innerHTML = queue.map((item, i) => `
    <div class="queue-item">
      <div class="queue-pos">${i + 1}</div>
      <div class="queue-info">
        <div class="queue-title">${escapeHtml(item.title || item.url)}</div>
        <div class="queue-by">\u{1F464} ${escapeHtml(item.addedBy || '?')}</div>
      </div>
      <button class="queue-remove" data-index="${i}" title="Remove">\u00D7</button>
    </div>
  `).join('');
}


// ── escapeHtml ───────────────────────────────────────────────────────────────
// Prevents XSS when inserting user-supplied strings into innerHTML.
// Any string rendered via renderQueue or renderMemberList must go through this.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Bootstrap
applyI18n();