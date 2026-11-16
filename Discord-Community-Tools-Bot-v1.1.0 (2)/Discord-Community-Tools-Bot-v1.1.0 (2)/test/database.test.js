import assert from 'node:assert/strict';
import test from 'node:test';
import { BotDatabase } from '../src/database.js';

test('stores only the selected feature data', () => {
  const database = new BotDatabase(':memory:');
  database.setRoles('guild-a', {
    pendingGroupOne: 'pending-1',
    verifiedGroupOne: 'verified-1',
    groupOneLabel: 'Sub',
    pendingGroupTwo: null,
    verifiedGroupTwo: 'verified-2',
    groupTwoLabel: 'Domme',
    moderator: 'moderator',
  });
  database.setTributeChannel('guild-a', 'tributes');
  database.setTicketSettings('guild-a', 'tickets', 'transcripts');
  database.saveStickyNote('guild-a', 'chat', 'Read the rules.', 'moderator');
  database.saveWheel('guild-a', 'Choices', ['One', 'Two'], 'moderator');
  database.addTribute({
    guildId: 'guild-a',
    recipientId: 'domme-a',
    senderId: 'sub-a',
    amountMinor: 2500,
    currency: 'USD',
    platform: 'Cash App',
    loggedBy: 'domme-a',
  });

  const settings = database.getSettings('guild-a');
  assert.equal(settings.group_one_label, 'Sub');
  assert.equal(settings.tribute_channel_id, 'tributes');
  assert.equal(settings.ticket_category_id, 'tickets');
  assert.equal(database.getStickyNote('guild-a', 'chat').content, 'Read the rules.');
  assert.deepEqual(database.getWheel('guild-a', 'choices').entries, ['One', 'Two']);
  assert.deepEqual(
    database.getSentTotals('guild-a', 'sub-a').map((row) => ({ ...row })),
    [{ currency: 'USD', total_minor: 2500, count: 1 }],
  );

  database.close();
});

test('creates and closes one private ticket record', () => {
  const database = new BotDatabase(':memory:');
  const ticket = database.createTicket('guild-a', 'channel-a', 'member-a', 'verification', 'Verify me');
  assert.equal(ticket.status, 'open');
  assert.equal(database.getOpenTicketByOwner('guild-a', 'member-a').channel_id, 'channel-a');
  assert.equal(database.closeTicket('guild-a', 'channel-a', 'moderator-a'), true);
  assert.equal(database.getOpenTicketByChannel('guild-a', 'channel-a'), null);
  database.close();
});

test('keeps different Discord servers isolated', () => {
  const database = new BotDatabase(':memory:');
  database.setTributeChannel('guild-a', 'channel-a');
  database.setTributeChannel('guild-b', 'channel-b');
  database.saveWheel('guild-a', 'Choices', ['One', 'Two'], 'mod-a');
  database.saveWheel('guild-b', 'Choices', ['Three', 'Four'], 'mod-b');

  assert.equal(database.getSettings('guild-a').tribute_channel_id, 'channel-a');
  assert.equal(database.getSettings('guild-b').tribute_channel_id, 'channel-b');
  assert.deepEqual(database.getWheel('guild-a', 'Choices').entries, ['One', 'Two']);
  assert.deepEqual(database.getWheel('guild-b', 'Choices').entries, ['Three', 'Four']);
  database.close();
});
