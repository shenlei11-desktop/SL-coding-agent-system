import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeClaudeCost } from '../bin/lib/pricing.mjs';

// --- computeClaudeCost ------------------------------------------------------------

test('computeClaudeCost: real captured opus-5 usage block costs exactly 0.13773575', () => {
  const usage = {
    input_tokens: 2,
    cache_creation_input_tokens: 14771,
    cache_read_input_tokens: 23714,
    output_tokens: 1342,
  };
  // Hand-verified: (2*5/1e6) + (14771*5*1.25/1e6) + (23714*5*0.1/1e6) + (1342*25/1e6)
  assert.equal(computeClaudeCost('claude-opus-5', usage), 0.13773575);
});

test('computeClaudeCost: model missing from PRICING returns null, not a throw', () => {
  const usage = { input_tokens: 100, output_tokens: 50 };
  assert.equal(computeClaudeCost('claude-instant-1', usage), null);
  // Dated id whose bare form is also unknown still misses after the fallback.
  assert.equal(computeClaudeCost('claude-fable-4-20250101', usage), null);
});

test('computeClaudeCost: dated model id falls back to the bare PRICING entry', () => {
  const usage = {
    input_tokens: 2,
    cache_creation_input_tokens: 14771,
    cache_read_input_tokens: 23714,
    output_tokens: 1342,
  };
  const bare = computeClaudeCost('claude-haiku-4-5', usage);
  assert.equal(typeof bare, 'number'); // matched a real entry, not null
  assert.equal(computeClaudeCost('claude-haiku-4-5-20251001', usage), bare);
});

test('computeClaudeCost: missing token fields count as 0, empty usage costs 0 not NaN', () => {
  assert.equal(computeClaudeCost('claude-sonnet-5', {}), 0);
  // Only output_tokens present: the missing fields default to 0, the present one is billed.
  assert.equal(computeClaudeCost('claude-sonnet-5', { output_tokens: 1000 }), 0.01);
});

test('computeClaudeCost: <synthetic> placeholder model returns null', () => {
  const usage = { input_tokens: 100, output_tokens: 50 };
  assert.equal(computeClaudeCost('<synthetic>', usage), null);
});
