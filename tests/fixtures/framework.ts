// Test fixture: framework anti-patterns
import express from "express";
const app = express();

// Async route without error handling
app.get("/users", async (req, res) => {
  const users = await db.getUsers();
  res.json(users);
});

// Error info leak
app.post("/data", async (req, res) => {
  try {
    await processData(req.body);
    res.json({ ok: true });
  } catch (err: any) {
    res.json({ error: err.message, stack: err.stack });
  }
});

// Safe: has error wrapper
app.get("/safe", asyncHandler(async (req, res) => {
  const data = await db.getData();
  res.json(data);
}));
