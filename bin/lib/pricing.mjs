/**
 * bin/lib/pricing.mjs — Claude model token pricing.
 *
 * Rates below were verified 2026-08 and should be reverified periodically
 * against the official pricing docs at https://platform.claude.com.
 * This file is the single edit point when rates change.
 */

export const PRICING = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-fable-5': { input: 10, output: 50 },
};

export const CACHE_WRITE_MULTIPLIER = 1.25;
export const CACHE_READ_MULTIPLIER = 0.1;

/**
 * Compute the dollar cost of a Claude Code session message.usage object.
 *
 * Missing or undefined token fields are treated as 0. If the model is not
 * present in the pricing table, returns null (does not throw).
 */
export function computeClaudeCost(model, usage, table = PRICING) {
  // Historical transcripts can carry a dated snapshot id (e.g.
  // "claude-haiku-4-5-20251001") even though current guidance is not to
  // construct these for new code. Fall back to the bare id so real past
  // usage isn't silently undercounted as "unknown model".
  const rates = table[model] ?? table[String(model || '').replace(/-\d{8}$/, '')];
  if (!rates) return null;

  const input = usage?.input_tokens ?? 0;
  const cacheCreate = usage?.cache_creation_input_tokens ?? 0;
  const cacheRead = usage?.cache_read_input_tokens ?? 0;
  const output = usage?.output_tokens ?? 0;

  return (
    (input * rates.input / 1e6) +
    (cacheCreate * rates.input * CACHE_WRITE_MULTIPLIER / 1e6) +
    (cacheRead * rates.input * CACHE_READ_MULTIPLIER / 1e6) +
    (output * rates.output / 1e6)
  );
}
