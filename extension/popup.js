// -------------------------------------------
// JamRoom - popup.js
// -------------------------------------------

// DOM references resolved once at startup — avoids repeated getElementById calls (DRY).
const countDisplay = document.getElementById('countDisplay');
const roomInput    = document.getElementById('roomInput');
const copyBtn      = document.getElementById('copyBtn');
const toast        = document.getElementById('toast');


// -------------------------------------------
// updateCopyVisibility
// Shows or hides the copy icon based on whether
// the user is in an active room. Single call site
// pattern — never toggled ad-hoc elsewhere (DRY).
// -------------------------------------------
function updateCopyVisibility(isInRoom) {
  copyBtn.style.display = isInRoom ? 'block' : 'none';
}


// -------------------------------------------
// showToast
// Displays a short-lived notification that slides
// in from the top of the popup.
// A pending hide timer is cleared before each new
// call so rapid clicks don't stack multiple timers.
// -------------------------------------------
let toastTimer = null;

function showToast(message, duration = 2000) {
  toast.textContent = message;
  toast.classList.add('show');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}


// -------------------------------------------
// COPY ROOM NAME
// Copies roomInput.value to the clipboard.
// roomInput.value is the single source of truth
// for the active room name — no duplicate state.
//
// Feedback:
//   icon  → ✓ (green) for 2 s, then resets to 📋
//   toast → "COPIED! — <roomId>" slides in for 2 s
// -------------------------------------------
let copyResetTimer = null;

copyBtn.addEventListener('click', () => {
  const roomId = roomInput.value.trim();
  if (!roomId) return;

  navigator.clipboard.writeText(roomId).then(() => {
    // Icon: swap clipboard emoji → green checkmark
    copyBtn.textContent = '\u2713';
    copyBtn.classList.add('btn--copied');

    // Toast: show room name confirmation
    showToast(chrome.i18n.getMessage('shareCopied') + ' \u2014 ' + roomId);

    clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      copyBtn.textContent = '\uD83D\uDCCB'; // 📋
      copyBtn.classList.remove('btn--copied');
    }, 2000);
  }).catch(() => {
    // clipboard API can fail if the popup loses focus mid-click;
    // silently ignore — the room name is still visible in the input.
  });
});


// -------------------------------------------
// applyI18n
// Replaces the textContent of every element
// that carries a [data-i18n] attribute with the
// corresponding chrome.i18n.getMessage() value.
//
// Why not __MSG_key__ directly in HTML?
// __MSG_key__ substitution only works in
// manifest fields, not in popup HTML pages (MV3).
// applyI18n() called once at startup is the
// correct idiomatic pattern for MV3 popups.
// -------------------------------------------
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key     = el.dataset.i18n;
    const message = chrome.i18n.getMessage(key);
    // Guard: keep existing text if the key is missing from messages.json
    // so the UI never silently goes blank during development.
    if (message) el.textContent = message;
  });
}


// -------------------------------------------
// setStatus
// Single place to update the status line.
// -------------------------------------------
function setStatus(text) {
  if (countDisplay) countDisplay.innerText = text;
}


// -------------------------------------------
// isYouTubeTab
// Extracted predicate used by both joinBtn and
// leaveBtn to avoid duplicating the same guard
// condition in two places (DRY).
// -------------------------------------------
function isYouTubeTab(tab) {
  return Boolean(tab && tab.url && tab.url.includes('youtube.com'));
}


// -------------------------------------------
// JOIN
// -------------------------------------------
document.getElementById('joinBtn').addEventListener('click', () => {
  const roomId = roomInput.value.trim();

  if (!roomId) {
    setStatus(chrome.i18n.getMessage('errorEnterRoomName'));
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!isYouTubeTab(tabs[0])) {
      setStatus(chrome.i18n.getMessage('errorOpenYouTubeJoin'));
      return;
    }

    // Persist room so the popup can restore state after being closed.
    chrome.storage.local.set({ savedRoomId: roomId }, () => {
      sendMessageToContent('JOIN_NEW_ROOM', roomId);
      setStatus(chrome.i18n.getMessage('statusJoining', [roomId]));
    });
  });
});


// -------------------------------------------
// LEAVE
// -------------------------------------------
document.getElementById('leaveBtn').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!isYouTubeTab(tabs[0])) {
      setStatus(chrome.i18n.getMessage('errorOpenYouTubeLeave'));
      return;
    }

    sendMessageToContent('LEAVE_ROOM', null);
    chrome.storage.local.remove(['savedRoomId', 'roomUserCount']);
    setStatus(chrome.i18n.getMessage('statusDefault'));
    updateCopyVisibility(false);
  });
});


// -------------------------------------------
// sendMessageToContent
// Sends a typed message to the active tab's
// content script and manages the badge state.
//
// Badge is set here rather than background.js
// because the popup already holds the active tab
// reference; a round-trip message would only add
// unnecessary latency.
// -------------------------------------------
function sendMessageToContent(type, data) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;

    chrome.tabs.sendMessage(tabs[0].id, { type, roomId: data });

    if (type === 'JOIN_NEW_ROOM') {
      chrome.action.setBadgeText({ text: 'ON', tabId: tabs[0].id });
      chrome.action.setBadgeBackgroundColor({ color: '#00FF00', tabId: tabs[0].id });
    } else if (type === 'LEAVE_ROOM') {
      chrome.action.setBadgeText({ text: '', tabId: tabs[0].id });
    }
  });
}


// -------------------------------------------
// Incoming messages from content.js
// ROOM_JOINED confirms the socket connected;
// we then wait 1.2 s for the server's first
// userListUpdate before rendering the member list.
// -------------------------------------------
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'ROOM_JOINED') return;

  if (msg.roomId) roomInput.value = msg.roomId;
  setStatus(chrome.i18n.getMessage('statusJoined', [msg.roomId]));

  setTimeout(() => {
    chrome.storage.local.get(['roomUserCount', 'roomUserList'], (res) => {
      const count = res.roomUserCount || 1;
      setStatus(chrome.i18n.getMessage('statusInRoom', [String(count)]));
      renderMemberList(res.roomUserList || []);
      updateCopyVisibility(true);
    });
  }, 1200);
});


// -------------------------------------------
// Real-time storage listener
// Reflects server-pushed userListUpdate and
// userCountUpdate while the popup is open —
// no close/reopen cycle required.
// -------------------------------------------
chrome.storage.onChanged.addListener((changes) => {
  if (changes.roomUserList) {
    renderMemberList(changes.roomUserList.newValue || []);
  }

  if (changes.roomUserCount) {
    const count = changes.roomUserCount.newValue || 0;
    const key   = count === 0 ? 'statusDefault' : 'statusInRoom';
    const args  = count === 0 ? []              : [String(count)];
    setStatus(chrome.i18n.getMessage(key, args));
  }
});


// -------------------------------------------
// Restore previous session on popup open.
// savedRoomId present → user is (or was) in a room.
// -------------------------------------------
chrome.storage.local.get(['savedRoomId', 'roomUserCount', 'roomUserList'], (result) => {
  if (result.savedRoomId) {
    roomInput.value = result.savedRoomId;
    const count     = result.roomUserCount || 1;
    setStatus(chrome.i18n.getMessage('statusInRoom', [String(count)]));
    renderMemberList(result.roomUserList || []);
    updateCopyVisibility(true);
  } else {
    roomInput.value = '';
    setStatus(chrome.i18n.getMessage('statusDefault'));
    renderMemberList([]);
    updateCopyVisibility(false);
  }
});


// -------------------------------------------
// renderMemberList
// Maps a nickname array to member-item divs.
// Clears the container when the list is empty
// so stale names never linger after a leave.
// Unicode escape for 👤 keeps the source file
// pure ASCII — avoids encoding issues in review.
// -------------------------------------------
function renderMemberList(list) {
  const container = document.getElementById('memberList');
  if (!container) return;

  if (!list || list.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = list
    .map(name => `<div class="member-item">\u{1F464} ${name}</div>`)
    .join('');
}


// Bootstrap: localize all [data-i18n] elements
// after the DOM is ready (script is deferred).
applyI18n();