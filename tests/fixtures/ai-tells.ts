// Test fixture: AI-generated code tells

// Initialize the counter
let counter = 0;

// Increment the counter
counter++;

// Return the result
function getResult(data: any) {
  // Get the user
  const user = data.user as any;

  // Check the value
  if (user.name) {
    // Set the name
    const name: any = user.name;
    return name;
  }

  return null;
}

// TODO: implement proper validation
function validate(input: string) {
  return true;
}

// FIXME: add error handling
function process(data: object) {
  return data;
}

// Safe: meaningful comment
// We use a 30-second timeout because the upstream API has p99 latency of 25s
const TIMEOUT = 30000;
