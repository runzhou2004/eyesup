// --- Configuration & State ---
const state = {
  isListening: false,
  messages: [],
  liveEvents: [],
  liveUnread: 0,
  activePage: "login",
  autoReadDrive: true,
  sse: null,
  keywords: [],
  settings: {
    autoDetect: true,
    blockGroup: false,
    speakEmojis: true
  }
};

const suggestedMessages = [
  { from: 'Mom', text: 'Are you coming home?', time: '9:41 AM' },
  { from: 'Boss', text: 'Meeting moved to Tuesday.', time: '10:32 AM' },
  { from: 'Friend', text: 'Coffee later?', time: '3:05 PM' }
];

// --- Browser Speech APIs ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.continuous = false;
recognition.lang = 'en-US';

// 1. TEXT TO SPEECH (Reading messages)
function speakText(text) {
  if (!text) return;
  if (!('speechSynthesis' in window)) return console.warn('Speech synthesis not supported');
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    // pick a cached voice if available
    if (window.__cachedVoice) utterance.voice = window.__cachedVoice;
    else {
      const voices = window.speechSynthesis.getVoices() || [];
      utterance.voice = voices.find(v => v.name && v.name.includes('Google US English')) || voices[0] || null;
    }
    utterance.lang = 'en-US';
    // Ensure speaking happens after voices are loaded; if none are available, try again after voiceschanged
    if ((window.speechSynthesis.getVoices() || []).length === 0) {
      const onvoices = () => {
        const vs = window.speechSynthesis.getVoices();
        utterance.voice = vs.find(v => v.name && v.name.includes('Google US English')) || vs[0] || null;
        window.speechSynthesis.speak(utterance);
        window.speechSynthesis.removeEventListener('voiceschanged', onvoices);
      };
      window.speechSynthesis.addEventListener('voiceschanged', onvoices);
      return;
    }
    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.error('speakText error', e);
  }
}

// cache voices when they become available (helps some browsers where getVoices is empty initially)
if ('speechSynthesis' in window) {
  const cacheVoices = () => {
    const vs = window.speechSynthesis.getVoices();
    if (vs && vs.length) {
      window.__cachedVoice = vs.find(v => v.name && v.name.includes('Google US English')) || vs[0];
    }
  };
  cacheVoices();
  window.speechSynthesis.addEventListener('voiceschanged', cacheVoices);
}

// 2. SPEECH TO TEXT (Sending messages)
recognition.onresult = (event) => {
  const transcript = event.results[0][0].transcript;
  console.log("Heard:", transcript);
  handleVoiceInput(transcript);
  state.isListening = false;
};


// --- Navigation Logic ---
function switchPage(pageName) {
  state.activePage = pageName;
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  const target = document.getElementById(`${pageName}View`);
  if (target) target.classList.remove('hidden');
  
  // Refresh data when entering pages
  if (pageName === 'contacts') loadContacts();
  if (pageName === 'keywords') loadKeywords();
  if (pageName === 'settings') loadSettings();
  if ((pageName === 'home' || pageName === 'drive') && isAuthenticated && !state.messages.length) loadMessages();

  // When navigating to the login page, treat it as logout (hide menu and clear auth)
  if (pageName === 'login') {
    demoToken = null;
    try { localStorage.removeItem('eyesup_token'); } catch(e) {}
    isAuthenticated = false;
    const mt = document.getElementById('menuToggle');
    if (mt) mt.hidden = true;
    // close menu if open
    if (typeof closeMenu === 'function') closeMenu();
  } else {
    // show menu toggle only when authenticated
    const mt = document.getElementById('menuToggle');
    if (mt) mt.hidden = !isAuthenticated;
  }
}

document.querySelectorAll('#nav button').forEach(btn => {
  btn.addEventListener('click', (e) => switchPage(e.target.getAttribute('data-page')));
});

// Menu toggle behavior: open/close slide-in menu
const menuToggle = document.getElementById('menuToggle');
const sideMenu = document.getElementById('sideMenu');
const menuOverlay = document.getElementById('menuOverlay');

function openMenu() {
  if (!sideMenu) return;
  sideMenu.classList.add('open');
  menuOverlay && menuOverlay.classList.add('open');
  menuToggle && menuToggle.setAttribute('aria-expanded', 'true');
  sideMenu.setAttribute('aria-hidden', 'false');
}

function closeMenu() {
  if (!sideMenu) return;
  sideMenu.classList.remove('open');
  menuOverlay && menuOverlay.classList.remove('open');
  menuToggle && menuToggle.setAttribute('aria-expanded', 'false');
  sideMenu.setAttribute('aria-hidden', 'true');
}

if (menuToggle) {
  menuToggle.addEventListener('click', () => {
    if (sideMenu.classList.contains('open')) closeMenu(); else openMenu();
  });
}

if (menuOverlay) {
  menuOverlay.addEventListener('click', () => closeMenu());
}

// Close menu when selecting a nav item
document.addEventListener('click', (e) => {
  const target = e.target;
  if (!target) return;
  if (target.closest && target.closest('#nav')) {
    // small delay so page switch takes effect then menu closes
    setTimeout(closeMenu, 120);
  }
});

// Close with Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenu();
});

// Logout helper to clear token and hide menu
window.logout = function() {
  demoToken = null;
  try { localStorage.removeItem('eyesup_token'); } catch(e) {}
  isAuthenticated = false;
  disconnectSSE();
  state.messages = [];
  state.liveEvents = [];
  state.settings = { autoDetect: true, blockGroup: false, speakEmojis: true };
  applySettingsToUI();
  renderConversation();
  renderLiveUpdates();
  const mt = document.getElementById('menuToggle');
  if (mt) mt.hidden = true;
  if (typeof closeMenu === 'function') closeMenu();
  switchPage('login');
};

// Ensure menu toggle visibility matches auth state on load
document.addEventListener('DOMContentLoaded', () => {
  const mt = document.getElementById('menuToggle');
  if (mt) mt.hidden = !isAuthenticated;
  // If the user info is available in localStorage, log it
  if (isAuthenticated) {
    try {
      const rawUser = localStorage.getItem('eyesup_user');
      if (rawUser) {
        const u = JSON.parse(rawUser);
        console.log('User logged in:', u.email || u.name || demoToken);
      } else {
        console.log('User logged in:', demoToken);
      }
    } catch (e) {
      console.log('User logged in:', demoToken);
    }
  }
  // initialize mic UI
  try { setMicStateMode('off'); } catch(e) {}
  applySettingsToUI();
});

 
// --- Chat/Home & Drive Messaging ---
function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return '';
  }
}

function renderMessageList(targetId) {
  const container = document.getElementById(targetId);
  if (!container) return;
  container.innerHTML = '';
  if (!state.messages.length) {
    container.innerHTML = '<div class="muted">No messages yet</div>';
    return;
  }
  state.messages.forEach(msg => {
    const div = document.createElement('div');
    div.className = `chat-bubble ${msg.outgoing ? 'outgoing' : 'incoming'}`;
    div.innerText = msg.text || '';
    container.appendChild(div);
  });
  container.scrollTop = container.scrollHeight;
}

function renderConversation() {
  renderMessageList('messages');
}

function renderLiveUpdates() {
  const container = document.getElementById('driveLiveList');
  const badge = document.getElementById('driveLiveCount');
  if (badge) {
    if (state.liveUnread > 0) {
      badge.style.display = 'inline-flex';
      badge.textContent = `${state.liveUnread} new`;
    } else {
      badge.style.display = 'none';
    }
  }
  if (!container) return;
  container.classList.add('muted');
  container.innerHTML = '';
}

function addLiveEvent(msg) {
  if (!msg) return;
  const existingIdx = state.liveEvents.findIndex(e => e.id === msg.id);
  if (existingIdx !== -1) return;
  state.liveEvents.push({
    id: msg.id || Date.now(),
    from: msg.from || 'Unknown',
    text: msg.text || '',
    timestamp: msg.timestamp || new Date().toISOString()
  });
  if (!msg.outgoing) state.liveUnread += 1;
  if (state.liveEvents.length > 12) {
    state.liveEvents = state.liveEvents.slice(-12);
  }
  renderLiveUpdates();
}

function addMessage(msg) {
  if (!msg) return;
  const normalized = {
    id: msg.id || Date.now(),
    from: msg.from || 'Unknown',
    text: msg.text || '',
    outgoing: !!msg.outgoing,
    timestamp: msg.timestamp || new Date().toISOString(),
    isGroup: !!msg.isGroup
  };
  const idx = state.messages.findIndex(m => m.id === normalized.id);
  if (idx >= 0) state.messages[idx] = normalized; else state.messages.push(normalized);
  state.messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  renderConversation();
}

function speakLatestMessages(count = 3) {
  if (!state.messages.length) {
    speakText('No messages yet.');
    return;
  }
  const recent = state.messages.slice(-count);
  const combined = recent.map(m => `${m.outgoing ? 'You said' : (m.from || 'Unknown sender')} ${m.text}`).join('. ');
  speakText(combined);
}

async function loadMessages() {
  if (!isAuthenticated) return;
  try {
    const res = await authFetch('/api/messages');
    const arr = await res.json();
    state.messages = Array.isArray(arr) ? arr : [];
    state.messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    renderConversation();
  } catch (e) {
    console.warn('Failed to load messages', e);
  }
}

function handleIncomingMessage(msg) {
  // 1. Check if this message ID already exists in our local state
  const alreadyExists = state.messages.some(m => m.id === msg.id);

  // 2. Add or update the message in the list
  addMessage(msg);
  addLiveEvent(msg);

  // 3. Only speak if the message is NEW (did not exist before this function ran)
  if (!alreadyExists && (state.activePage === 'drive' || state.activePage === 'home') && state.autoReadDrive && !msg.outgoing) {
    const shouldRead = messageMatchesActiveKeywords(msg);
    if (shouldRead) speakText(`New from ${msg.from || 'unknown'}: ${msg.text}`);
  }
}

function messageMatchesActiveKeywords(msg) {
  const active = state.keywords.filter(k => k.active && k.text);
  if (!active.length) return true; // no filter set, read everything
  const text = (msg.text || '').toLowerCase();
  return active.some(k => text.includes((k.text || '').toLowerCase()));
}

function handleVoiceCommand(original, lowered) {
  if (lowered.includes('read') && (lowered.includes('message') || lowered.includes('messages') || lowered.includes('updates') || lowered.includes('conversation'))) {
    // tailor which to read
    if (lowered.includes('suggest')) {
      const combined = suggestedMessages.map(s => `${s.from} says ${s.text}`).join('. ');
      speakText(combined || 'No suggestions.');
    } else if (lowered.includes('conversation')) {
      speakLatestMessages(5);
    } else {
      speakLatestMessages();
    }
    return true;
  }
  if (lowered.includes('show') && (lowered.includes('update') || lowered.includes('updates'))) {
    state.liveUnread = 0;
    renderLiveUpdates();
    openModal('Live Updates', renderUpdatesPreview());
    return true;
  }
  if (lowered.includes('show') && lowered.includes('suggest')) {
    openModal('Suggested Messages', renderSuggestionsPreview());
    return true;
  }
  if (lowered.includes('show') && (lowered.includes('conversation') || lowered.includes('convo') || lowered.includes('chat'))) {
    openModal('Current Conversation', renderConversationPreview());
    return true;
  }
  if (lowered.includes('pause') && lowered.includes('read')) {
    state.autoReadDrive = false;
    speakText('Auto reading paused');
    return true;
  }
  if (lowered.includes('resume') || (lowered.includes('auto') && lowered.includes('read'))) {
    state.autoReadDrive = true;
    speakText('Auto reading on');
    return true;
  }
  if (lowered.startsWith('reply')) {
    const stripped = original.replace(/reply\s*(to)?/i, '').trim();
    if (stripped) {
      sendOutgoing(stripped);
    } else {
      speakText('Say reply followed by your message');
    }
    return true;
  }
  return false;
}

async function handleVoiceInput(transcript) {
  if (!transcript) return;
  const lowered = transcript.toLowerCase();
  if (handleVoiceCommand(transcript, lowered)) return;
  await sendOutgoing(transcript);
}

async function sendOutgoing(text) {
  if (!isAuthenticated) {
    alert('Please log in to send messages');
    return;
  }
  const lastIncoming = [...state.messages].reverse().find(m => !m.outgoing);
  const to = lastIncoming?.from || 'Recent contact';
  const payload = { to, text };
  try {
    const res = await authFetch('/api/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await res.json();
    addMessage(body || { ...payload, outgoing: true, id: Date.now(), timestamp: new Date().toISOString() });
  } catch (e) {
    addMessage({ ...payload, outgoing: true, id: Date.now(), timestamp: new Date().toISOString() });
  }
}

// "Simulate Incoming" Button
const simulateBtn = document.getElementById('simulateBtn');
if (simulateBtn) {
  simulateBtn.addEventListener('click', async () => {
    const texts = [
      "Hey, are you driving?",
      "Don't forget to pick up milk.",
      "Meeting starts in 10 minutes!"
    ];
    const randomText = texts[Math.floor(Math.random() * texts.length)];
    try {
      const res = await authFetch('/api/incoming', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'Sim Contact', text: randomText, isGroup: false })
      });
      const msg = await res.json();
      handleIncomingMessage(msg);
    } catch (e) {
      // fall back to local rendering
      handleIncomingMessage({ id: Date.now(), from: 'Sim Contact', text: randomText, outgoing: false, timestamp: new Date().toISOString() });
    }
  });
}

const driveReadBtn = document.getElementById('driveReadBtn');
async function handleDriveReadLatest() {
  if (!isAuthenticated) {
    alert('Please log in first.');
    return;
  }
  if (!state.messages.length) {
    await loadMessages();
  }
  if (!state.messages.length) {
    alert('No messages yet.');
    return;
  }
  state.liveUnread = 0;
  renderLiveUpdates();
  speakLatestMessages();
}

function renderUpdatesPreview() {
  if (!state.liveEvents.length) return '<div class="muted">No updates yet</div>';
  return state.liveEvents.slice(-10).reverse().map(evt => `
    <div class="live-item">
      <span>${evt.from ? `${evt.from}: ` : ''}${evt.text}</span>
      <span class="time">${formatTime(evt.timestamp)}</span>
    </div>
  `).join('');
}
if (driveReadBtn) driveReadBtn.addEventListener('click', handleDriveReadLatest);

// Modal helpers
const modalOverlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const modalClose = document.getElementById('modalClose');

function openModal(title, html) {
  if (!modalOverlay || !modalTitle || !modalBody) return;
  modalTitle.textContent = title;
  modalBody.innerHTML = html;
  modalOverlay.classList.add('open');
  modalOverlay.setAttribute('aria-hidden', 'false');
}
function closeModal() {
  if (!modalOverlay) return;
  modalOverlay.classList.remove('open');
  modalOverlay.setAttribute('aria-hidden', 'true');
}
if (modalClose) modalClose.addEventListener('click', closeModal);
if (modalOverlay) modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

function renderConversationPreview() {
  if (!state.messages.length) return '<div class="muted">No messages yet</div>';
  return state.messages.slice(-8).reverse().map(m => `
    <div class="chat-bubble ${m.outgoing ? 'outgoing' : 'incoming'}">${m.text || ''}</div>
  `).join('');
}

function renderSuggestionsPreview() {
  return suggestedMessages.map(s => `
    <div class="live-item" style="border:1px solid #f0ebff; background:#f9f6ff;">
      <div>
        <strong>${s.from}</strong> <span class="muted small">${s.time}</span><br/>
        ${s.text}
      </div>
    </div>
  `).join('');
}

const drivePreviewConvoBtn = document.getElementById('drivePreviewConvoBtn');
if (drivePreviewConvoBtn) drivePreviewConvoBtn.addEventListener('click', () => {
  openModal('Current Conversation', renderConversationPreview());
});

const drivePreviewSuggestionsBtn = document.getElementById('drivePreviewSuggestionsBtn');
if (drivePreviewSuggestionsBtn) drivePreviewSuggestionsBtn.addEventListener('click', () => {
  openModal('Suggested Messages', renderSuggestionsPreview());
});

const drivePreviewUpdatesBtn = document.getElementById('drivePreviewUpdatesBtn');
if (drivePreviewUpdatesBtn) drivePreviewUpdatesBtn.addEventListener('click', () => {
  state.liveUnread = 0;
  renderLiveUpdates();
  openModal('Live Updates', renderUpdatesPreview());
});

function disconnectSSE() {
  if (state.sse) {
    try { state.sse.close(); } catch (_) {}
    state.sse = null;
  }
}

function connectSSE() {
  if (!demoToken) return;
  disconnectSSE();
  try {
    const es = new EventSource(`/api/stream?t=${encodeURIComponent(demoToken)}`);
    state.sse = es;
    es.onmessage = (event) => {
      if (!event.data) return;
      try {
        const payload = JSON.parse(event.data);
        if (payload.status === 'connected') return;
        handleIncomingMessage(payload);
      } catch (err) {
        console.warn('Failed to parse SSE message', err);
      }
    };
    es.onerror = () => {
      disconnectSSE();
      if (isAuthenticated) {
        setTimeout(connectSSE, 3000);
      }
    };
  } catch (e) {
    console.warn('SSE connection failed', e);
  }
}

// "Mic" Buttons (Home & Drive Mode)
const startListening = () => {
  if (state.isListening) return;
  try {
    // update UI to show listening (no voice detected yet)
    const micEl = document.getElementById('micCircle');
    if (micEl) {
      micEl.setAttribute('aria-pressed', 'true');
      micEl.classList.remove('mic-off');
      micEl.classList.add('mic-listening');
    }
    // start audio monitor (permission prompt + level detection)
    startAudioMonitor();
    recognition.start();
    state.isListening = true;
  } catch (e) { console.error(e); }
};

// Check if elements exist before adding listeners (to prevent errors)
const homeMic = document.querySelector('.mic-circle');
if(homeMic) homeMic.addEventListener('click', startListening);

const driveMic = document.getElementById('d_micBtn');
if(driveMic) driveMic.addEventListener('click', startListening);
const driveExitBtn = document.getElementById('d_exitBtn');
if (driveExitBtn) driveExitBtn.addEventListener('click', () => switchPage('home'));


// Mic UI helper
const micEl = document.getElementById('micCircle');
const driveMicEl = document.getElementById('d_micBtn');
const driveStatusEl = document.getElementById('driveMicStatus');
function setMicStateMode(mode) {
  // mode: 'off' | 'listening' | 'voice'
  if (micEl) {
    micEl.classList.remove('mic-off', 'mic-listening', 'mic-voice');
    if (mode === 'off') {
      micEl.classList.add('mic-off');
      micEl.setAttribute('aria-pressed', 'false');
    } else if (mode === 'listening') {
      micEl.classList.add('mic-listening');
      micEl.setAttribute('aria-pressed', 'true');
    } else if (mode === 'voice') {
      micEl.classList.add('mic-voice');
      micEl.setAttribute('aria-pressed', 'true');
    }
  }
  if (driveMicEl) {
    driveMicEl.classList.remove('mic-off', 'mic-listening', 'mic-voice');
    if (mode === 'off') {
      driveMicEl.classList.add('mic-off');
      driveMicEl.setAttribute('aria-pressed', 'false');
    } else if (mode === 'listening') {
      driveMicEl.classList.add('mic-listening');
      driveMicEl.setAttribute('aria-pressed', 'true');
    } else if (mode === 'voice') {
      driveMicEl.classList.add('mic-voice');
      driveMicEl.setAttribute('aria-pressed', 'true');
    }
  }
  const statusEl = document.getElementById('micStatus');
  if (statusEl) {
    statusEl.classList.remove('mic-status--off', 'mic-status--listening', 'mic-status--voice', 'mic-status--error');
    if (mode === 'off') { statusEl.textContent = 'Off'; statusEl.classList.add('mic-status--off'); }
    else if (mode === 'listening') { statusEl.textContent = 'Listening (no voice)'; statusEl.classList.add('mic-status--listening'); }
    else if (mode === 'voice') { statusEl.textContent = 'Voice detected'; statusEl.classList.add('mic-status--voice'); }
    else { statusEl.textContent = 'Error'; statusEl.classList.add('mic-status--error'); }
  }
  if (driveStatusEl) {
    driveStatusEl.classList.remove('mic-status--off', 'mic-status--listening', 'mic-status--voice', 'mic-status--error');
    if (mode === 'off') { driveStatusEl.textContent = 'Off'; driveStatusEl.classList.add('mic-status--off'); }
    else if (mode === 'listening') { driveStatusEl.textContent = 'Listening (no voice)'; driveStatusEl.classList.add('mic-status--listening'); }
    else if (mode === 'voice') { driveStatusEl.textContent = 'Voice detected'; driveStatusEl.classList.add('mic-status--voice'); }
    else { driveStatusEl.textContent = 'Error'; driveStatusEl.classList.add('mic-status--error'); }
  }
}

// Speech recognition event wiring for visual feedback
if (recognition) {
  recognition.onstart = () => {
    state.isListening = true;
    setMicStateMode('listening');
  };
  recognition.onsoundstart = () => {
    // any sound detected - treat as input present
    setMicStateMode('voice');
  };
  recognition.onspeechstart = () => {
    setMicStateMode('voice');
  };
  recognition.onspeechend = () => {
    // speech ended; back to listening (no voice) until recognition ends
    setMicStateMode('listening');
  };
  recognition.onend = () => {
    state.isListening = false;
    setMicStateMode('off');
    stopAudioMonitor();
  };
  recognition.onaudioend = () => {
    // if recognition still running but audio ended, show listening/no-voice
    if (state.isListening) setMicStateMode('listening');
  };
  recognition.onerror = (ev) => {
    console.error('Speech recognition error', ev.error);
    state.isListening = false;
    // indicate error/no voice
    setMicStateMode('listening');
    // also show error text briefly
    const statusEl = document.getElementById('micStatus');
    if (statusEl) { statusEl.textContent = 'Recognition error'; statusEl.classList.add('mic-status--error'); }
    stopAudioMonitor();
  };
}

// Audio level monitor using getUserMedia + AnalyserNode
let _audioStream = null;
let _audioCtx = null;
let _analyser = null;
let _dataArray = null;
let _volInterval = null;
function startAudioMonitor() {
  if (_audioStream) return; // already running
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    _audioStream = stream;
    try {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = _audioCtx.createMediaStreamSource(stream);
      _analyser = _audioCtx.createAnalyser();
      _analyser.fftSize = 512;
      source.connect(_analyser);
      _dataArray = new Uint8Array(_analyser.frequencyBinCount);
      _volInterval = setInterval(() => {
        _analyser.getByteTimeDomainData(_dataArray);
        // compute normalized rms
        let sum = 0;
        for (let i = 0; i < _dataArray.length; i++) {
          const v = (_dataArray[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / _dataArray.length);
        // threshold tuned for typical laptop mic; adjust if too sensitive
        const threshold = 0.02;
        if (rms > threshold) setMicStateMode('voice');
        else setMicStateMode('listening');
      }, 120);
    } catch (e) {
      console.warn('AudioContext failed', e);
    }
  }).catch(err => {
    console.warn('getUserMedia error', err);
    const statusEl = document.getElementById('micStatus');
    if (statusEl) { statusEl.textContent = 'Microphone blocked'; statusEl.classList.add('mic-status--error'); }
  });
}

function stopAudioMonitor() {
  if (_volInterval) { clearInterval(_volInterval); _volInterval = null; }
  if (_analyser) { _analyser.disconnect && _analyser.disconnect(); _analyser = null; }
  if (_audioCtx) { try { _audioCtx.close(); } catch(e) {} _audioCtx = null; }
  if (_audioStream) {
    _audioStream.getTracks().forEach(t => t.stop());
    _audioStream = null;
  }
}


// --- Contact Logic ---
// simple auth token stored here after login
// Load token from storage if present
const storedToken = localStorage.getItem('eyesup_token');
let demoToken = storedToken || null;
let isAuthenticated = !!demoToken;

// helper to call authenticated endpoints
async function authFetch(path, opts = {}) {
  opts.headers = opts.headers || {};
  opts.headers['Content-Type'] = 'application/json';
  if (demoToken) opts.headers['Authorization'] = 'Bearer ' + demoToken;
  const res = await fetch(path, opts);
  if (res.status === 401) {
    alert('Unauthorized - please log in');
    // clear stored token and redirect to login
    localStorage.removeItem('eyesup_token');
    demoToken = null;
    isAuthenticated = false;
    disconnectSSE();
    state.messages = [];
    state.liveEvents = [];
    renderConversation();
    renderLiveUpdates();
    switchPage('login');
    throw new Error('unauthorized');
  }
  return res;
}

// 1. Load and Display Contacts
async function loadContacts() {
  const res = await authFetch('/api/contacts');
  const contacts = await res.json();
  const list = document.getElementById('contactsList');
  list.innerHTML = ''; // Clear current list

  if (contacts.length === 0) {
    list.innerHTML = '<div style="text-align:center; color:#ccc; padding:10px;">No contacts yet</div>';
    return;
  }

  contacts.forEach(c => {
    const isTemp = c.type === 'temporary';
    const initial = c.name.charAt(0).toUpperCase();
    const priority = c.priority || 'normal';
    const pillClass = priority === 'emergency' ? 'pill pill--emergency' : priority === 'priority' ? 'pill pill--priority' : 'pill';
    const priorityLabel = priority.charAt(0).toUpperCase() + priority.slice(1);
    
    // Formatting the date if it exists
    let timeString = '';
    if (isTemp && c.endTime) {
      const date = new Date(c.endTime);
      timeString = `<div style="font-size:10px; color:#d81b60;">Ends: ${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>`;
    }

    const html = `
      <div class="contact-item" data-id="${c.id}" style="${isTemp ? 'border-left: 3px solid #d81b60; background:#fff0f5;' : ''}">
        <div class="avatar" style="${isTemp ? 'background:#f48fb1; color:#880e4f;' : ''}">${initial}</div>
        <div style="flex:1;">
            <div style="font-weight:bold; display:flex; align-items:center;">
              ${c.name} 
              ${isTemp ? '<span style="font-size:12px; margin-left:5px;">TEMP</span>' : ''}
              <span class="${pillClass}" style="margin-left:6px;">${priorityLabel}</span>
            </div>
            <div style="font-size:11px; color:#888">${c.number}</div>
            ${timeString}
        </div>
        <button onclick="deleteContact(${c.id})" style="width:auto; padding:5px 10px; background:#eee; color:#333; font-size:10px; margin:0;">X</button>
      </div>
    `;
    list.insertAdjacentHTML('beforeend', html);
  });
}

// 2. Add Standard Contact
document.getElementById('addStandardBtn').addEventListener('click', async () => {
  const name = document.getElementById('new_c_name').value;
  const number = document.getElementById('new_c_number').value;
  const priority = document.getElementById('new_c_priority')?.value || 'normal';

  if (!name || !number) return alert("Name and Number are required.");

  await authFetch('/api/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      name, 
      number, 
      type: 'permanent',
      priority
    })
  });

  // Clear inputs and reload
  document.getElementById('new_c_name').value = '';
  document.getElementById('new_c_number').value = '';
  loadContacts();
});

// Backwards-compatible handler for older HTML (single add button)
const legacyAddBtn = document.getElementById('addContactBtn');
if (legacyAddBtn) {
  legacyAddBtn.addEventListener('click', async () => {
    const name = document.getElementById('c_name').value;
    const numberEl = document.getElementById('c_number');
    const number = numberEl ? numberEl.value : '';
    if (!name || !number) return alert('Name and Number are required.');
    await authFetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, number, type: 'permanent' })
    });
    document.getElementById('c_name').value = '';
    if (numberEl) numberEl.value = '';
    loadContacts();
  });
}

// 3. Add Temporary Contact
document.getElementById('addTempBtn').addEventListener('click', async () => {
  const name = document.getElementById('temp_c_name').value;
  const number = document.getElementById('temp_c_number').value;
  const start = document.getElementById('temp_start').value;
  const end = document.getElementById('temp_end').value;
  const priority = document.getElementById('temp_c_priority')?.value || 'normal';

  if (!name || !end) return alert("Name and End Time are required for temporary contacts.");

  await authFetch('/api/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      name, 
      number, 
      type: 'temporary',
      startTime: start,
      endTime: end,
      priority
    })
  });

  // Clear inputs and reload
  document.getElementById('temp_c_name').value = '';
  document.getElementById('temp_c_number').value = '';
  document.getElementById('temp_start').value = '';
  document.getElementById('temp_end').value = '';
  loadContacts();
});

// 4. Delete Contact Helper
window.deleteContact = async (id) => {
  if(!confirm("Remove this contact?")) return;

  // Optimistically remove from UI
  const el = document.querySelector(`.contact-item[data-id="${id}"]`);
  let removedHtml = null;
  if (el) {
    removedHtml = el.outerHTML;
    el.remove();
  }

  try {
    const res = await authFetch(`/api/contacts/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      throw new Error('Delete failed');
    }
  } catch (e) {
    // On failure, restore the item and alert
    if (removedHtml) {
      const list = document.getElementById('contactsList');
      list.insertAdjacentHTML('afterbegin', removedHtml);
    }
    alert('Failed to remove contact. Please try again.');
  }
};


// --- Keyword Logic ---
function renderKeywords() {
  const container = document.getElementById('keywordsList');
  if (!container) return;
  const searchTerm = (document.getElementById('kwSearch')?.value || '').toLowerCase();
  container.innerHTML = '';
  const activeCount = state.keywords.filter(k => k.active).length;
  const countEl = document.getElementById('kwActiveCount');
  if (countEl) countEl.textContent = `${activeCount} active`;
  const filtered = state.keywords.filter(k => !searchTerm || (k.text || '').toLowerCase().includes(searchTerm));
  if (!filtered.length) {
    container.innerHTML = '<div class="muted" style="padding:8px 0;">No keywords yet</div>';
    return;
  }
  filtered.forEach(k => {
    const priority = k.priority || 'normal';
    const row = document.createElement('div');
    row.className = 'contact-item keyword-item';
    row.style.justifyContent = 'space-between';
    row.style.background = 'transparent';
    row.style.borderBottom = '1px solid #eee';
    row.style.padding = '6px 0';
    row.innerHTML = `
      <span style="display:flex; flex-direction:column; gap:4px;">
        <strong>${k.text}</strong>
        <small class="muted">Priority: ${k.priority || 'normal'}</small>
      </span>
      <div style="display:flex; align-items:center; gap:8px;">
        <select class="kw-priority" data-id="${k.id}">
          <option value="normal" ${priority === 'normal' ? 'selected' : ''}>Normal</option>
          <option value="priority" ${priority === 'priority' ? 'selected' : ''}>Priority</option>
          <option value="emergency" ${priority === 'emergency' ? 'selected' : ''}>Emergency</option>
        </select>
        <input type="checkbox" title="Active" data-id="${k.id}" ${k.active ? 'checked' : ''}>
      </div>
    `;
    container.appendChild(row);
  });
}

async function persistKeywords() {
  try {
    await authFetch('/api/keywords', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.keywords)
    });
  } catch (e) {
    alert('Failed to save keywords');
  }
}

async function loadKeywords() {
  try {
    const res = await authFetch('/api/keywords');
    const keywords = await res.json();
    state.keywords = Array.isArray(keywords) ? keywords.map(k => ({
      id: k.id || Date.now() + Math.random(),
      text: k.text || '',
      active: typeof k.active === 'undefined' ? true : !!k.active,
      priority: k.priority || 'normal'
    })) : [];
    renderKeywords();
  } catch (e) {
    console.warn('Failed to load keywords', e);
  }
}

document.getElementById('kwSearch')?.addEventListener('input', renderKeywords);

const kwListEl = document.getElementById('keywordsList');
if (kwListEl) {
  kwListEl.addEventListener('change', (e) => {
    const target = e.target;
    if (target && target.matches('input[type="checkbox"][data-id]')) {
      const id = Number(target.getAttribute('data-id'));
      const idx = state.keywords.findIndex(k => Number(k.id) === id);
      if (idx >= 0) {
        state.keywords[idx].active = target.checked;
        persistKeywords();
      }
    } else if (target && target.matches('select.kw-priority[data-id]')) {
      const id = Number(target.getAttribute('data-id'));
      const idx = state.keywords.findIndex(k => Number(k.id) === id);
      if (idx >= 0) {
        state.keywords[idx].priority = target.value || 'normal';
        persistKeywords();
        renderKeywords();
      }
    }
  });
}

document.getElementById('saveKwBtn').addEventListener('click', async () => {
  const text = document.getElementById('kwText').value;
  if (!text) return;

  // split comma separated keywords into array of objects
  const arr = text.split(',').map(s => s.trim()).filter(Boolean).map(t => ({
    id: Date.now() + Math.random(),
    text: t,
    active: true,
    priority: 'normal'
  }));

  state.keywords.push(...arr);
  document.getElementById('kwText').value = '';
  renderKeywords();
  await persistKeywords();
});

// --- Settings Logic ---
function applySettingsToUI() {
  const autoDetect = document.getElementById('s_autoDetect');
  const blockGroup = document.getElementById('s_blockGroup');
  const speakEmojis = document.getElementById('s_speakEmojis');
  if (autoDetect) autoDetect.checked = !!state.settings.autoDetect;
  if (blockGroup) blockGroup.checked = !!state.settings.blockGroup;
  if (speakEmojis) speakEmojis.checked = !!state.settings.speakEmojis;
}

async function loadSettings() {
  if (!isAuthenticated) return;
  try {
    const res = await authFetch('/api/settings');
    const data = await res.json();
    state.settings = { ...state.settings, ...(data || {}) };
    applySettingsToUI();
  } catch (e) {
    console.warn('Failed to load settings', e);
  }
}

async function saveSettings() {
  const autoDetect = document.getElementById('s_autoDetect')?.checked || false;
  const blockGroup = document.getElementById('s_blockGroup')?.checked || false;
  const speakEmojis = document.getElementById('s_speakEmojis')?.checked || false;
  state.settings = { autoDetect, blockGroup, speakEmojis };
  try {
    const res = await authFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.settings)
    });
    if (res.ok) alert('Settings saved'); else alert('Failed to save settings');
  } catch (e) {
    alert('Failed to save settings');
  }
}

document.getElementById('saveSettingsBtn')?.addEventListener('click', saveSettings);

// --- Login Logic ---
function handleLoginSuccess(token) {
  if (!token) return;
  demoToken = token;
  try { localStorage.setItem('eyesup_token', demoToken); } catch(e) {}
  isAuthenticated = true;
  const mt = document.getElementById('menuToggle');
  if (mt) mt.hidden = false;
  connectSSE();
  loadContacts();
  loadKeywords();
  loadSettings();
  loadMessages();
  switchPage('home');
}

document.getElementById('loginBtn').addEventListener('click', async () => {
  const email = document.getElementById('email')?.value || 'test@example.com';
  const password = document.getElementById('password')?.value || 'password';
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const body = await r.json();
    if (r.ok && body.token) {
        handleLoginSuccess(body.token);
    } else {
      alert(body.error || 'login failed');
    }
  } catch (e) {
    alert('Network error');
  }
});

// Start
if (isAuthenticated) {
  handleLoginSuccess(demoToken);
} else {
  switchPage('login');
}
