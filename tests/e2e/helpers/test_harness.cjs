/**
 * Test Harness Utility for NFT Radar E2E Verification Suite
 */

const assert = require('assert');

class TestHarness {
  constructor(suiteName) {
    this.suiteName = suiteName;
    this.tests = [];
    this.passes = 0;
    this.fails = 0;
    this.startTime = Date.now();
  }

  async test(name, fn) {
    const testEntry = { name, passed: false, error: null, duration: 0 };
    const t0 = Date.now();
    try {
      await fn();
      testEntry.passed = true;
      testEntry.duration = Date.now() - t0;
      this.passes++;
      console.log(`  [PASS] ${name} (${testEntry.duration}ms)`);
    } catch (err) {
      testEntry.passed = false;
      testEntry.error = err;
      testEntry.duration = Date.now() - t0;
      this.fails++;
      console.log(`  [FAIL] ${name} (${testEntry.duration}ms)`);
      console.log(`         Error: ${err.message}`);
      if (err.expected !== undefined && err.actual !== undefined) {
        console.log(`         Expected: ${JSON.stringify(err.expected)}`);
        console.log(`         Actual:   ${JSON.stringify(err.actual)}`);
      }
    }
    this.tests.push(testEntry);
  }

  summary() {
    const total = this.tests.length;
    const duration = Date.now() - this.startTime;
    console.log(`\n--- ${this.suiteName} Summary ---`);
    console.log(`Total: ${total} | Passed: ${this.passes} | Failed: ${this.fails} | Time: ${duration}ms`);
    return {
      suite: this.suiteName,
      total,
      passes: this.passes,
      fails: this.fails,
      duration,
      allPassed: this.fails === 0
    };
  }
}

module.exports = {
  TestHarness,
  assert
};
