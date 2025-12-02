// --- Configuration & State ---
const state = {
  isListening: false
};

// --- Browser Speech APIs ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.continuous = false;
recognition.lang = 'en-US';

// 1. TEXT TO SPEECH (Reading messages)
function speakText(text) {
  if (!text) return;
  const utterance = new SpeechSynthesisUtterance(text);
  // Optional: Select a specific voice (e.g., Google US English)
  const voices = window.speechSynthesis.getVoices();
  utterance.voice = voices.find(v => v.name.includes('Google US English')) || voices[0];
  window.speechSynthesis.speak(utterance);
}

// 2. SPEECH TO TEXT (Sending messages)
recognition.onresult = (event) => {
  const transcript = event.results[0][0].transcript;
  console.log("Heard:", transcript);
  
  // Add to chat as outgoing message
  addMessageToUI(transcript, 'outgoing');
  
  // In a real app, you would POST this to /api/messages here
  state.isListening = false;
};

recognition.onerror = (event) => {
  console.error("Speech error:", event.error);
  state.isListening = false;
};


// --- Navigation Logic ---
function switchPage(pageName) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  const target = document.getElementById(`${pageName}View`);
  if (target) target.classList.remove('hidden');
  
  // Refresh data when entering pages
  if (pageName === 'contacts') loadContacts();
  if (pageName === 'keywords') loadKeywords();
}

document.querySelectorAll('#nav button').forEach(btn => {
  btn.addEventListener('click', (e) => switchPage(e.target.getAttribute('data-page')));
});


// --- Chat/Home Logic ---
function addMessageToUI(text, type) {
  const container = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = `chat-bubble ${type}`;
  div.innerText = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// "Simulate Incoming" Button
document.getElementById('simulateBtn').addEventListener('click', () => {
  const texts = [
    "Hey, are you driving?", 
    "Don't forget to pick up milk.", 
    "Meeting starts in 10 minutes!"
  ];
  const randomText = texts[Math.floor(Math.random() * texts.length)];
  
  addMessageToUI(randomText, 'incoming');
  speakText(randomText); // <--- READS ALOUD
});

// "Mic" Buttons (Home & Drive Mode)
const startListening = () => {
  if (state.isListening) return;
  try {
    recognition.start();
    state.isListening = true;
    alert("Listening... speak now.");
  } catch (e) { console.error(e); }
};

// Check if elements exist before adding listeners (to prevent errors)
const homeMic = document.querySelector('.mic-circle');
if(homeMic) homeMic.addEventListener('click', startListening);

const driveMic = document.getElementById('d_micBtn');
if(driveMic) driveMic.addEventListener('click', startListening);


// --- Contact Logic ---
// simple auth token stored here after login
// Load token from storage or use demo token for demo mode so actions work without explicit login
let demoToken = localStorage.getItem('eyesup_token') || 'demo-token-123';

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
              ${isTemp ? '<span style="font-size:12px; margin-left:5px;">🕒</span>' : ''}
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

  if (!name || !number) return alert("Name and Number are required.");

  await authFetch('/api/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      name, 
      number, 
      type: 'permanent' 
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

  if (!name || !end) return alert("Name and End Time are required for temporary contacts.");

  await authFetch('/api/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      name, 
      number, 
      type: 'temporary',
      startTime: start,
      endTime: end
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
async function loadKeywords() {
  const res = await authFetch('/api/keywords');
  const keywords = await res.json();
  
  // Find the container (reuse the list area or create a new one)
  // For this demo, we will insert them into the keywordsView container
  const container = document.getElementById('keywordsView');
  
  // Remove old keyword items (keep the input and button)
  const oldItems = container.querySelectorAll('.keyword-item');
  oldItems.forEach(el => el.remove());
  // Helper to render keywords (clears oldItems before calling)
  function renderKeywords(list) {
    const textarea = container.querySelector('#kwText');
    // Insert each item after the textarea so they appear below the input
    list.forEach(k => {
      const html = `
      <div class="contact-item keyword-item" style="justify-content:space-between; background:transparent; border-bottom:1px solid #eee; padding:6px 0;">
         <span>${k.text}</span>
         <input type="checkbox" ${k.active ? 'checked' : ''}>
      </div>
      `;
      if (textarea) textarea.insertAdjacentHTML('afterend', html);
      else container.insertAdjacentHTML('beforeend', html);
    });
  }

  renderKeywords(keywords || []);
}

document.getElementById('saveKwBtn').addEventListener('click', async () => {
  const text = document.getElementById('kwText').value;
  if (!text) return;

  // split comma separated keywords into array of objects
  const arr = text.split(',').map(s => s.trim()).filter(Boolean).map(t => ({ text: t, active: true }));

  const res = await authFetch('/api/keywords', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(arr)
  });

  if (res.ok) {
    const body = await res.json().catch(() => null);
    alert("Keywords saved!");
    document.getElementById('kwText').value = '';
    // If server returned the newly created keywords, append them immediately
    if (body && Array.isArray(body.keywords) && body.keywords.length) {
      // render just the new ones by calling loadKeywords to ensure full sync
      loadKeywords();
    } else {
      // fallback: reload full list
      loadKeywords();
    }
  } else {
    alert('Failed to save keywords');
  }
});

// --- Login Logic ---
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
      demoToken = body.token;
      switchPage('home');
      loadContacts();
      loadKeywords();
    } else {
      alert(body.error || 'login failed');
    }
  } catch (e) {
    alert('Network error');
  }
});

// Start
switchPage('login');