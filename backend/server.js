import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dbFile = path.join(__dirname, "db.json");
const adapter = new JSONFile(dbFile);

// ---- Initialize DB with default structure ----
const db = new Low(adapter, { users: [], messages: [], contacts: [], keywords: [], settings: {} });

await db.read();

// Ensure db.json exists and has data
db.data ||= { users: [], messages: [], contacts: [], keywords: [], settings: {} };
await db.write();
// ------------------------------------------------

const app = express();
app.use(cors());
app.use(express.json());

// Middleware to check authentication token
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "") || req.query.t;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  req.user = { token };
  next();
}

// ========== AUTH ENDPOINTS ==========

// Login endpoint
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  // FOR DEMO PURPOSES ONLY:
  // Accept any login if email and password are provided.
  // In a real app, you would check db.data.users for a match and hash passwords.
  if (email && password) {
    console.log(`User logged in: ${email}`);
    res.json({ success: true, token: "demo-token-123" });
  } else {
    res.status(401).json({ error: "Invalid credentials" });
  }
});

// ========== MESSAGE ENDPOINTS ==========

// Get messages
app.get("/api/messages", authMiddleware, async (req, res) => {
  await db.read();
  res.json(db.data.messages || []);
});

// Post incoming message (simulates incoming SMS/message)
app.post("/api/incoming", authMiddleware, async (req, res) => {
  const { from, text, isGroup } = req.body;
  if (!from || !text) return res.status(400).json({ error: "from and text required" });
  
  const msg = {
    id: Date.now(),
    from,
    text,
    isGroup: !!isGroup,
    timestamp: new Date().toISOString(),
    outgoing: false
  };
  
  await db.read();
  db.data.messages ||= [];
  db.data.messages.push(msg);
  await db.write();
  
  // Broadcast to any connected SSE clients
  broadcastMessage(msg);
  res.json(msg);
});

// Post reply (outgoing message)
app.post("/api/reply", authMiddleware, async (req, res) => {
  const { to, text } = req.body;
  if (!to || !text) return res.status(400).json({ error: "to and text required" });
  
  const msg = {
    id: Date.now(),
    from: to,
    text,
    timestamp: new Date().toISOString(),
    outgoing: true
  };
  
  await db.read();
  db.data.messages ||= [];
  db.data.messages.push(msg);
  await db.write();
  
  res.json(msg);
});

// ========== CONTACTS ENDPOINTS ==========

// Get contacts (Removed authMiddleware)
app.get("/api/contacts", async (req, res) => {
  await db.read();
  res.json(db.data.contacts || []);
});

// Post contact (Removed authMiddleware)
app.post("/api/contacts", async (req, res) => {
  const { name, number } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  
  const contact = {
    id: Date.now(),
    name,
    number: number || "No number"
  };
  
  await db.read();
  db.data.contacts ||= [];
  db.data.contacts.push(contact);
  await db.write();
  
  res.json(contact);
});

// ========== KEYWORDS ENDPOINTS ==========

// Get keywords (Removed authMiddleware)
app.get("/api/keywords", async (req, res) => {
  await db.read();
  res.json(db.data.keywords || []);
});

// Post keywords (Updated logic)
app.post("/api/keywords", async (req, res) => {
  const { text } = req.body; // Frontend sends { text: "urgent, home" }
  
  if (!text) return res.status(400).json({ error: "Text required" });

  // Split string into individual keyword objects
  const newKeywords = text.split(',').map(k => ({
    id: Date.now() + Math.random(), 
    text: k.trim(), 
    active: true 
  })).filter(k => k.text);
  
  await db.read();
  db.data.keywords ||= [];
  db.data.keywords.push(...newKeywords);
  await db.write();
  
  res.json({ success: true, keywords: newKeywords });
});

// ========== SETTINGS ENDPOINTS ==========

// Get settings
app.get("/api/settings", authMiddleware, async (req, res) => {
  await db.read();
  res.json(db.data.settings || {});
});

// Post settings
app.post("/api/settings", authMiddleware, async (req, res) => {
  const settings = req.body;
  await db.read();
  db.data.settings = settings;
  await db.write();
  res.json({ success: true });
});

// ========== SSE STREAM ==========

const sseClients = [];

app.get("/api/stream", authMiddleware, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  
  sseClients.push(res);
  
  // Send a ping to confirm connection
  res.write("data: {\"status\":\"connected\"}\n\n");
  
  // Clean up on disconnect
  req.on("close", () => {
    const idx = sseClients.indexOf(res);
    if (idx > -1) sseClients.splice(idx, 1);
  });
});

// Helper to broadcast messages to SSE clients
function broadcastMessage(msg) {
  sseClients.forEach(client => {
    try {
      client.write(`data: ${JSON.stringify(msg)}\n\n`);
    } catch (e) {
      console.error("Error broadcasting to SSE client:", e);
    }
  });
}

// ========== STATIC FILE SERVING ==========

// Serve frontend static files (so visiting / will return the SPA)
const frontendDir = path.join(__dirname, "..", "frontend");
app.use(express.static(frontendDir));

// SPA fallback: if the request isn't for /api, return index.html so client-side routing works
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(frontendDir, "index.html"));
});

// ========== SERVER STARTUP ==========

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Stop the process using that port or set PORT to a free port and restart.`);
  } else {
    console.error("Server error:", err);
  }
  process.exit(1);
});