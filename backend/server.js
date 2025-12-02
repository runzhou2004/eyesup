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
const db = new Low(adapter, { users: [] });   // ⭐ default data FIX

await db.read();

// Ensure db.json exists and has data
db.data ||= { users: [] };
await db.write();
// ------------------------------------------------

const app = express();
app.use(cors());
app.use(express.json());

// Create user entry
app.post("/api/user", async (req, res) => {
  const { name } = req.body;

  if (!name) return res.status(400).json({ error: "Name is required" });

  db.data.users.push({
    id: Date.now(),
    name,
    createdAt: new Date().toISOString()
  });

  await db.write();
  res.json({ success: true });
});

// Example GET
app.get("/api/users", async (req, res) => {
  res.json(db.data.users);
});

app.listen(3001, () => {
  console.log("Backend running on http://localhost:3001");
});
