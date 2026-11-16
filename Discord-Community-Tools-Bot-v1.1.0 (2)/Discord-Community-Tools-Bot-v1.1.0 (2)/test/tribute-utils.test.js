import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GBP_TO_USD_RATE,
  convertToUsdMinor,
  summarizeSentTotals,
} from '../src/tribute-utils.js';

test('uses the fixed conversion rate for tribute totals', () => {
  assert.equal(GBP_TO_USD_RATE, 1.27);
  assert.equal(convertToUsdMinor(35700, 4500), 41415);
  assert.equal(convertToUsdMinor(3100, 9000), 14530);
});

test('summarizes both currencies without combining their displayed values', () => {
  const summary = summarizeSentTotals([
    { currency: 'USD', total_minor: 35700, count: 16 },
    { currency: 'GBP', total_minor: 4500, count: 5 },
  ]);
  assert.deepEqual(summary, {
    usdMinor: 35700,
    gbpMinor: 4500,
    count: 21,
    convertedUsdMinor: 41415,
  });
});

