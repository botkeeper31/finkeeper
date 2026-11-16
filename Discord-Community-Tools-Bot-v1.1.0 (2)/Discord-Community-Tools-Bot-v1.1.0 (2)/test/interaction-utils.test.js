import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageFlags } from 'discord.js';
import { safelyReportInteractionError } from '../src/interaction-utils.js';

test('edits the existing response after a deferred interaction fails', async () => {
  let payload;
  const interaction = {
    deferred: true,
    replied: false,
    async editReply(value) { payload = value; },
  };

  await safelyReportInteractionError(interaction, new Error('Role update failed'));
  assert.deepEqual(payload, { content: 'Something went wrong: Role update failed' });
});

test('uses Discord response flags for a private error message', async () => {
  let payload;
  const interaction = {
    deferred: false,
    replied: false,
    async reply(value) { payload = value; },
  };

  await safelyReportInteractionError(interaction, new Error('Test failure'));
  assert.equal(payload.flags, MessageFlags.Ephemeral);
});

test('swallows an expired-interaction error instead of crashing the bot', async () => {
  const warnings = [];
  const interaction = {
    deferred: false,
    replied: false,
    async reply() { throw Object.assign(new Error('Unknown interaction'), { code: 10062 }); },
  };
  const logger = {
    warn(message) { warnings.push(message); },
    error() { assert.fail('An expired interaction must not become an unhandled error.'); },
  };

  await assert.doesNotReject(() => safelyReportInteractionError(
    interaction,
    new Error('Original failure'),
    logger,
  ));
  assert.equal(warnings.length, 1);
});
