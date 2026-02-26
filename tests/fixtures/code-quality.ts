// Test fixture: code quality smells

console.log("debug: starting");

function processData(input: string) {
  console.log("input:", input);
  console.log("processing...");
  console.debug("step 1");
  console.log("step 2");
  return input.toUpperCase();
}

// TODO: implement caching
function getCache() {
  return null;
}

// FIXME: handle edge cases
function calculate(a: number, b: number) {
  return a + b;
}
