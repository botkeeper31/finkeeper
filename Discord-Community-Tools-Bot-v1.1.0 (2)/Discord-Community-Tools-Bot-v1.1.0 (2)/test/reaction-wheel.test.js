import assert from 'node:assert/strict';
import test from 'node:test';
import { REACTION_WHEEL_EMOJI, buildReactionWheelEntrants } from '../src/reaction-wheel.js';

test('uses the ticket reaction for one-spin signup wheels', () => {
  assert.equal(REACTION_WHEEL_EMOJI, '🎟️');
});

test('creates one readable entry per non-bot reactor', () => {
  const users = [
    { id: '3', username: 'helper', bot: true },
    { id: '2', username: 'alice', bot: false },
    { id: '1', username: 'queen_scarlett', bot: false },
  ];
  const members = new Map([
    ['1', { displayName: '👑 𝓠𝓾𝓮𝓮𝓷 Scarlett ✨' }],
    ['2', { displayName: '🖤✨' }],
  ]);

  assert.deepEqual(buildReactionWheelEntrants(users, members), [
    { userId: '2', label: 'alice' },
    { userId: '1', label: 'Queen Scarlett' },
  ]);
});
