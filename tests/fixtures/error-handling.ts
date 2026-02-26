// Test fixture: error handling smells

async function fetchData() {
  try {
    const res = await fetch("/api/data");
    return res.json();
  } catch (e) { }
}

async function saveData(data: object) {
  try {
    await fetch("/api/save", { method: "POST", body: JSON.stringify(data) });
  } catch (err) {
    console.error(err);
  }
}

// Swallowed promise
fetch("/api/status").then(r => r.json());

// Safe: proper error handling
async function goodFetch() {
  try {
    const res = await fetch("/api/data");
    return res.json();
  } catch (err) {
    console.error("Failed to fetch:", err);
    throw new Error("Data fetch failed");
  }
}
