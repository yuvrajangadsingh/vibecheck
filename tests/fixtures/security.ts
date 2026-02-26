// Test fixture: security smells

const API_KEY = "xk_test_abcdef1234567890abcdef1234567890";
const dbPassword = "SuperSecretPassword123!@#$%";

function getUserData(userId: string) {
  // SQL injection via string concatenation
  const query = `SELECT * FROM users WHERE id = ${userId}`;
  return query;
}

function renderContent(html: string) {
  document.getElementById("app")!.innerHTML = html;
}

function runCode(input: string) {
  return eval(input);
}

// Safe patterns that should NOT trigger
const safeKey = process.env.API_KEY;
const example = "api_key=your-key-here";
