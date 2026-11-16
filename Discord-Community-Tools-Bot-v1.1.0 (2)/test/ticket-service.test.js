import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTicketTranscript, ticketChannelName } from '../src/ticket-service.js';

test('creates safe and recognizable ticket channel names', () => {
  assert.equal(ticketChannelName('verification', 'Aims Angelic ☁️', '123456789012345678'), 'verification-aims-angelic-5678');
});

test('builds a readable ticket transcript with attachments', () => {
  const transcript = buildTicketTranscript({
    guildName: 'Test Server',
    channelName: 'verification-member-1234',
    ticket: {
      id: 4,
      channel_id: 'channel-a',
      owner_id: 'member-a',
      ticket_type: 'verification',
      subject: 'Verify me',
      created_at: '2026-08-18T10:00:00.000Z',
    },
    closedBy: { tag: 'Moderator#0001', id: 'mod-a' },
    messages: [{
      createdTimestamp: Date.parse('2026-08-18T10:01:00.000Z'),
      author: { tag: 'Member#0001', id: 'member-a' },
      content: 'Hello!',
      attachments: new Map([['file', { url: 'https://example.test/proof.png' }]]),
      embeds: [],
    }],
  });
  assert.match(transcript, /Ticket Transcript/);
  assert.match(transcript, /Type: Verification/);
  assert.match(transcript, /Member#0001 \(member-a\): Hello!/);
  assert.match(transcript, /Attachment: https:\/\/example\.test\/proof\.png/);
});
