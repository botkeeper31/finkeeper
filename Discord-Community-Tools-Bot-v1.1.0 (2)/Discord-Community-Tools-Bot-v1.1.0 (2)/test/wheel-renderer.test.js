import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMMUNITY_PASTEL_PALETTE,
  WHEEL_ANIMATION,
  chooseWheelResult,
  parseWheelEntries,
  renderWheelGif,
  sanitizeWheelLabel,
} from '../src/wheel-renderer.js';

test('uses a sixteen-color community pastel palette', () => {
  assert.equal(COMMUNITY_PASTEL_PALETTE.length, 16);
  assert.deepEqual(COMMUNITY_PASTEL_PALETTE[0], { name: 'Strawberry Milk', hex: '#FF9FC5' });
  assert.deepEqual(COMMUNITY_PASTEL_PALETTE.at(-1), { name: 'Cotton Candy', hex: '#FFAEDB' });
});

test('renders at least thirty moving frames per second while preserving the 2.55-second duration', () => {
  assert.equal(WHEEL_ANIMATION.frameCount - 1, 35);
  assert.ok(1000 / WHEEL_ANIMATION.movingFrameDelayMs >= 30);
  const totalDuration = ((WHEEL_ANIMATION.frameCount - 1) * WHEEL_ANIMATION.movingFrameDelayMs)
    + WHEEL_ANIMATION.winnerFrameDelayMs;
  assert.equal(totalDuration, 2550);
});

test('parses comma, pipe, and newline wheel entries', () => {
  assert.deepEqual(parseWheelEntries('A, B, C'), ['A', 'B', 'C']);
  assert.deepEqual(parseWheelEntries('A | B | C'), ['A', 'B', 'C']);
  assert.deepEqual(parseWheelEntries('A\nB\nC'), ['A', 'B', 'C']);
});

test('rejects wheels that are too small', () => {
  assert.throws(() => parseWheelEntries('Only one'), /at least 2/i);
});

test('allows deterministic result selection in tests', () => {
  assert.equal(chooseWheelResult(['A', 'B', 'C'], () => 2), 2);
});

test('normalizes decorative names and removes unsupported emoji glyphs', () => {
  assert.equal(sanitizeWheelLabel('  👑 𝓠𝓾𝓮𝓮𝓷 Scarlett ✨  '), 'Queen Scarlett');
  assert.equal(sanitizeWheelLabel('🖤✨', 'discord_username'), 'discord_username');
});

test('renders an animated GIF with the chosen result', { timeout: 30000 }, () => {
  const rendered = renderWheelGif(['Alpha', 'Beta', 'Gamma'], 1);
  assert.equal(rendered.result, 'Beta');
  assert.equal(rendered.buffer.subarray(0, 6).toString('ascii'), 'GIF89a');
  assert.ok(rendered.buffer.length > 1000);
});

test('renders decorated member names without changing the selected result', { timeout: 30000 }, () => {
  const entries = ['👑 𝓠𝓾𝓮𝓮𝓷 Scarlett ✨', 'Princess Very Long Name 💎', 'Lady Lavish 🖤'];
  const rendered = renderWheelGif(entries, 0);
  assert.equal(rendered.result, entries[0]);
  assert.equal(rendered.buffer.subarray(0, 6).toString('ascii'), 'GIF89a');
});
