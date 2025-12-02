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
async function loadContacts() {
  const res = await fetch('/api/contacts');
  const contacts = await res.json();
  const list = document.getElementById('contactsList');
  list.innerHTML = ''; // Clear current list

  contacts.forEach(c => {
    const initial = c.name.charAt(0).toUpperCase();
    const html = `
      <div class="contact-item">
        <div class="avatar">${initial}</div>
        <div>
            <div style="font-weight:bold">${c.name}</div>
            <div style="font-size:11px; color:#888">${c.number || ''}</div>
        </div>
      </div>
    `;
    list.insertAdjacentHTML('beforeend', html);
  });
}

document.getElementById('addContactBtn').addEventListener('click', async () => {
  const name = document.getElementById('c_name').value;
  // Using the "Start Time" input as a dummy phone number input for this demo
  // In your real HTML, ensure you have an input with id="c_number" if needed
  const number = "555-0199"; 

  if (!name) return alert("Name required");

  const res = await fetch('/api/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, number })
  });

  if (res.ok) {
    document.getElementById('c_name').value = '';
    loadContacts(); // Refresh list
  }
});


// --- Keyword Logic ---
async function loadKeywords() {
  const res = await fetch('/api/keywords');
  const keywords = await res.json();
  
  // Find the container (reuse the list area or create a new one)
  // For this demo, we will insert them into the keywordsView container
  const container = document.getElementById('keywordsView');
  
  // Remove old keyword items (keep the input and button)
  const oldItems = container.querySelectorAll('.keyword-item');
  oldItems.forEach(el => el.remove());

  // Add new items below the search bar
  keywords.forEach(k => {
    const html = `
      <div class="contact-item keyword-item" style="justify-content:space-between; background:transparent; border-bottom:1px solid #eee;">
         <span>${k.text}</span>
         <input type="checkbox" ${k.active ? 'checked' : ''}>
      </div>
    `;
    // Insert after the search input (first input in the view)
    container.querySelector('input').insertAdjacentHTML('afterend', html);
  });
}

document.getElementById('saveKwBtn').addEventListener('click', async () => {
  const text = document.getElementById('kwText').value;
  if (!text) return;

  const res = await fetch('/api/keywords', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });

  if (res.ok) {
    alert("Keywords saved!");
    document.getElementById('kwText').value = '';
    loadKeywords(); // Refresh the list immediately
  }
});

// --- Login Logic ---
document.getElementById('loginBtn').addEventListener('click', async () => {
  // Simple bypass for demo
  switchPage('home');
});

// Start
switchPage('login');