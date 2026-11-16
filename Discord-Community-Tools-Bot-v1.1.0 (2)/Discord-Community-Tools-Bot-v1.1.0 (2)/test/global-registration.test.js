import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

test('registers global commands without restricting the bot to one guild ID', () => {
  assert.match(source, /Routes\.applicationCommands\(process\.env\.CLIENT_ID\)/);
  assert.doesNotMatch(source, /applicationGuildCommands/);
  assert.doesNotMatch(source, /GUILD_ID/);
});
