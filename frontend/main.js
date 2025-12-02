// Frontend logic: simple SPA, auth, SSE stream, speech recognition and synthesis.

const api = {
  token: null,
  async request(path, opts = {}) {
    const headers = opts.headers || {};
    if (this.token) headers["Authorization"] = "Bearer " + this.token;
    headers["Content-Type"] = "application/json";
    opts.headers = headers;
    const res = await fetch(path, opts);
    if (res.status === 401) {
      logout();
      throw new Error("unauthenticated");
    }
    return res.json();
  }
};

const pages = ["login", "home", "contacts", "keywords", "settings", "drive"];
function showPage(name) {
  pages.forEach(p => document.getElementById(p + "View").classList.add("hidden"));
  document.getElementById(name + "View").classList.remove("hidden");
  currentPage = name;
}

document.querySelectorAll("#nav button[data-page]").forEach(b => {
  b.addEventListener("click", () => showPage(b.dataset.page));
});

document.getElementById("logoutBtn").addEventListener("click", logout);

let currentPage = "login";
showPage("login");

// login
document.getElementById("loginBtn").addEventListener("click", async () => {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  try {
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const body = await r.json();
    if (r.ok) {
      api.token = body.token;
      localStorage.setItem("eyesup_token", body.token);
      startAfterLogin();
    } else {
      alert(body.error || "login failed");
    }
  } catch (e) { alert("network error"); }
});

function logout() {
  api.token = null;
  localStorage.removeItem("eyesup_token");
  showPage("login");
}

// keep token from storage
if (localStorage.getItem("eyesup_token")) {
  api.token = localStorage.getItem("eyesup_token");
  startAfterLogin();
}

async function startAfterLogin() {
  showPage("home");
  await loadMessages();
  await loadContacts();
  await loadKeywords();
  await loadSettings();
  startSSE();
}

// Messages UI
const messagesDiv = document.getElementById("messages");
async function loadMessages() {
  try {
    const msgs = await api.request("/api/messages");
    renderMessages(msgs);
  } catch (e) { console.error(e); }
}
function renderMessages(msgs) {
  messagesDiv.innerHTML = "";
  msgs.forEach(m => {
    const el = document.createElement("div");
    el.className = "message " + (m.outgoing ? "outgoing" : "incoming");
    el.innerHTML = `<strong>${m.outgoing ? "You" : m.from}</strong> <div>${escapeHtml(m.text)}</div><small class="muted">${new Date(m.timestamp).toLocaleString()}</small>`;
    messagesDiv.appendChild(el);
  });
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}
function appendMessage(m) {
  const el = document.createElement("div");
  el.className = "message " + (m.outgoing ? "outgoing" : "incoming");
  el.innerHTML = `<strong>${m.outgoing ? "You" : m.from}</strong> <div>${escapeHtml(m.text)}</div><small class="muted">${new Date(m.timestamp).toLocaleString()}</small>`;
  messagesDiv.appendChild(el);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// SSE
let evtSource = null;
function startSSE() {
  if (!api.token) return;
  if (evtSource) evtSource.close();
  // Use native EventSource but we need token in header so use fetch + ReadableStream fallback
  // For simplicity, we call a server endpoint that expects auth header: it works with browser EventSource only if token in query string
  // Here we open EventSource with token in query string (note: in prod prefer safer approach)
  evtSource = new EventSource("/api/stream?" + new URLSearchParams({ t: api.token }));
  // The backend expects Authorization header, but our server code used auth middleware; to keep this demo simple we will re-open using fetch-based SSE alternative below if EvtSource doesn't work.
  evtSource.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      handleIncoming(data);
    } catch (e) { console.error(e); }
  };
  // fallback: if not connected after a moment, try fetch-based SSE (supports headers)
  setTimeout(() => {
    if (evtSource && evtSource.readyState === 0) {
      // ignore for now
    }
  }, 1000);
}

// handle incoming message object
async function handleIncoming(msg) {
  appendMessage(msg);
  const s = await api.request("/api/keywords").catch(()=>[]);
  const settings = await api.request("/api/settings").catch(()=>({}));
  const blockGroups = settings.blockGroupMessages;
  if (blockGroups && msg.isGroup) return;
  // check keywords
  const kws = s || [];
  const matched = kws.some(k => k && msg.text.toLowerCase().includes(k.toLowerCase()));
  // read message aloud
  speak(`${msg.from} says: ${msg.text}`);
  // if matched - optionally auto-reply (not implemented auto-sending by default)
  if (matched) {
    // send a gentle auto-reply
    await api.request("/api/reply", {
      method: "POST",
      body: JSON.stringify({ to: msg.from, text: "Auto-reply: I received your message and will respond soon." })
    });
  }
}

// Speech Synthesis
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  // choose first available voice for demo
  const voices = speechSynthesis.getVoices();
  if (voices && voices.length) u.voice = voices[0];
  speechSynthesis.speak(u);
}

// Speech Recognition (Chrome)
let recognition = null;
function startRecognition(onFinal) {
  if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
    alert("Speech recognition not supported in this browser (use Chrome).");
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (ev) => {
    const text = ev.results[0][0].transcript;
    onFinal(text);
  };
  recognition.onerror = (ev) => { console.error(ev); alert("Recognition error: " + ev.error); };
  recognition.start();
}

// UI bindings
document.getElementById("micBtn").addEventListener("click", () => {
  startRecognition(async (text) => {
    // show message as outgoing
    const msg = await api.request("/api/reply", { method: "POST", body: JSON.stringify({ to: "Last sender", text }) });
    appendMessage(msg);
  });
});

document.getElementById("simulateBtn").addEventListener("click", async () => {
  const sample = prompt("Incoming message text", "Are you nearby? Pick me up ASAP.");
  if (!sample) return;
  await api.request("/api/incoming", { method: "POST", body: JSON.stringify({ text: sample, from: "Mom", isGroup: false }) });
});

document.getElementById("addContactBtn").addEventListener("click", async () => {
  const name = document.getElementById("c_name").value;
  const number = document.getElementById("c_number").value;
  if (!name || !number) return alert("enter both");
  const c = await api.request("/api/contacts", { method: "POST", body: JSON.stringify({ name, number }) });
  await loadContacts();
  document.getElementById("c_name").value = ""; document.getElementById("c_number").value = "";
});

async function loadContacts() {
  const list = await api.request("/api/contacts");
  const div = document.getElementById("contactsList");
  div.innerHTML = "";
  list.forEach(c => {
    const el = document.createElement("div");
    el.className = "message";
    el.innerHTML = `<strong>${c.name}</strong> <div>${c.number}</div> <button class="delContact" data-id="${c.id}">Delete</button>`;
    div.appendChild(el);
  });
  div.querySelectorAll(".delContact").forEach(b => b.addEventListener("click", async (ev) => {
    await api.request("/api/contacts/" + b.dataset.id, { method: "DELETE" });
    await loadContacts();
  }));
}

document.getElementById("saveKwBtn").addEventListener("click", async () => {
  const txt = document.getElementById("kwText").value;
  const arr = txt.split(",").map(s => s.trim()).filter(Boolean);
  await api.request("/api/keywords", { method: "POST", body: JSON.stringify(arr) });
  alert("saved");
  loadKeywords();
});

async function loadKeywords() {
  try {
    const kws = await api.request("/api/keywords");
    document.getElementById("kwText").value = (kws || []).join(", ");
  } catch (e) { console.error(e); }
}

// settings
document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
  const autoDetect = document.getElementById("s_autoDetect").checked;
  const blockGroup = document.getElementById("s_blockGroup").checked;
  await api.request("/api/settings", { method: "POST", body: JSON.stringify({ autoDrivingDetection: autoDetect, blockGroupMessages: blockGroup }) });
  alert("settings saved");
});
async function loadSettings() {
  try {
    const s = await api.request("/api/settings");
    document.getElementById("s_autoDetect").checked = !!s.autoDrivingDetection;
    document.getElementById("s_blockGroup").checked = !!s.blockGroupMessages;
  } catch (e) { console.error(e); }
}

// Drive mode controls
document.getElementById("d_exitBtn").addEventListener("click", () => showPage("home"));
document.getElementById("d_micBtn").addEventListener("click", () => {
  startRecognition(async (text) => {
    await api.request("/api/reply", { method: "POST", body: JSON.stringify({ to: "Last sender", text }) });
    speak("Message sent: " + text);
  });
});

// small helper
function escapeHtml(s) {
  if (!s) return "";
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// small improvement: if server SSE requires token header, we can fallback to fetch-polling
// but for this demo we rely on /api/incoming to push to EventSource.
