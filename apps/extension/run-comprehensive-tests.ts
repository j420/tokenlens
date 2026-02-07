/**
 * Standalone runner for comprehensive tests
 * Run with: npx ts-node run-comprehensive-tests.ts
 */

import { runComprehensiveTests } from "./src/comprehensive-tests";

console.log("\nRunning Comprehensive Tests...\n");

const results = runComprehensiveTests();

for (const line of results.summary) {
  console.log(line);
}

// Exit with error code if any tests failed
process.exit(results.totalFailed > 0 ? 1 : 0);
