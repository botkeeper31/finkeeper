import assert from 'node:assert/strict';
import test from 'node:test';
import { commandData } from '../src/commands.js';

test('registers only the six intended command groups', () => {
  assert.deepEqual(commandData.map((command) => command.name), [
    'setup',
    'verify',
    'tribute',
    'ticket',
    'sticky',
    'wheel',
  ]);
});

test('does not expose removed or unfinished features', () => {
  const serialized = JSON.stringify(commandData);
  for (const removed of ['confess', 'qotd', 'game', 'gif', 'reaction-role', 'welcome', 'custom']) {
    assert.equal(serialized.includes(`\"name\":\"${removed}\"`), false);
  }
});
