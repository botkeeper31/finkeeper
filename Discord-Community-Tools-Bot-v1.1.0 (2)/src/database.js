import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class BotDatabase {
  constructor(databasePath) {
    if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    if (databasePath !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL;');
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        pending_group_one_role_id TEXT,
        verified_group_one_role_id TEXT,
        group_one_label TEXT NOT NULL DEFAULT 'Member',
        pending_group_two_role_id TEXT,
        verified_group_two_role_id TEXT,
        group_two_label TEXT NOT NULL DEFAULT 'Creator',
        moderator_role_id TEXT,
        tribute_channel_id TEXT,
        ticket_category_id TEXT,
        ticket_transcript_channel_id TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS wheels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL,
        entries_json TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (guild_id, name_key)
      );

      CREATE TABLE IF NOT EXISTS reaction_wheel_sessions (
        message_id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (guild_id, created_by)
      );

      CREATE TABLE IF NOT EXISTS tributes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
        currency TEXT NOT NULL CHECK (currency IN ('USD', 'GBP')),
        platform TEXT NOT NULL,
        logged_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_tributes_sender
        ON tributes(guild_id, sender_id, created_at);

      CREATE TABLE IF NOT EXISTS sticky_notes (
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        content TEXT NOT NULL,
        message_id TEXT,
        updated_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (guild_id, channel_id)
      );

      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL UNIQUE,
        owner_id TEXT NOT NULL,
        ticket_type TEXT NOT NULL CHECK (ticket_type IN ('verification', 'support', 'other')),
        subject TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        closed_at TEXT,
        closed_by TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_tickets_owner
        ON tickets(guild_id, owner_id, status);
    `);
  }

  close() {
    this.db.close();
  }

  ensureGuild(guildId) {
    this.db.prepare('INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)').run(guildId);
  }

  getSettings(guildId) {
    this.ensureGuild(guildId);
    return this.db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
  }

  setRoles(guildId, roles) {
    this.ensureGuild(guildId);
    this.db.prepare(`
      UPDATE guild_settings SET
        pending_group_one_role_id = ?, verified_group_one_role_id = ?, group_one_label = ?,
        pending_group_two_role_id = ?, verified_group_two_role_id = ?, group_two_label = ?,
        moderator_role_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE guild_id = ?
    `).run(
      roles.pendingGroupOne,
      roles.verifiedGroupOne,
      roles.groupOneLabel,
      roles.pendingGroupTwo,
      roles.verifiedGroupTwo,
      roles.groupTwoLabel,
      roles.moderator,
      guildId,
    );
  }

  setTributeChannel(guildId, channelId) {
    this.ensureGuild(guildId);
    this.db.prepare(`
      UPDATE guild_settings SET tribute_channel_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE guild_id = ?
    `).run(channelId, guildId);
  }

  setTicketSettings(guildId, categoryId, transcriptChannelId) {
    this.ensureGuild(guildId);
    this.db.prepare(`
      UPDATE guild_settings SET ticket_category_id = ?, ticket_transcript_channel_id = ?,
        updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?
    `).run(categoryId, transcriptChannelId, guildId);
  }

  createTicket(guildId, channelId, ownerId, ticketType, subject = null) {
    const result = this.db.prepare(`
      INSERT INTO tickets (guild_id, channel_id, owner_id, ticket_type, subject)
      VALUES (?, ?, ?, ?, ?)
    `).run(guildId, channelId, ownerId, ticketType, subject);
    return this.db.prepare('SELECT * FROM tickets WHERE id = ?').get(result.lastInsertRowid);
  }

  getOpenTicketByOwner(guildId, ownerId) {
    return this.db.prepare(`
      SELECT * FROM tickets WHERE guild_id = ? AND owner_id = ? AND status = 'open'
      ORDER BY id DESC LIMIT 1
    `).get(guildId, ownerId) || null;
  }

  getOpenTicketByChannel(guildId, channelId) {
    return this.db.prepare(`
      SELECT * FROM tickets WHERE guild_id = ? AND channel_id = ? AND status = 'open'
      LIMIT 1
    `).get(guildId, channelId) || null;
  }

  closeTicket(guildId, channelId, closedBy) {
    return this.db.prepare(`
      UPDATE tickets SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_by = ?
      WHERE guild_id = ? AND channel_id = ? AND status = 'open'
    `).run(closedBy, guildId, channelId).changes > 0;
  }

  saveWheel(guildId, name, entries, createdBy) {
    const nameKey = normalizeKey(name);
    this.db.prepare(`
      INSERT INTO wheels (guild_id, name, name_key, entries_json, created_by)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, name_key) DO UPDATE SET
        name = excluded.name,
        entries_json = excluded.entries_json,
        created_by = excluded.created_by,
        updated_at = CURRENT_TIMESTAMP
    `).run(guildId, name.trim(), nameKey, JSON.stringify(entries), createdBy);
    return this.getWheel(guildId, name);
  }

  getWheel(guildId, name) {
    const row = this.db.prepare('SELECT * FROM wheels WHERE guild_id = ? AND name_key = ?').get(guildId, normalizeKey(name));
    return row ? { ...row, entries: JSON.parse(row.entries_json) } : null;
  }

  listWheels(guildId) {
    return this.db.prepare('SELECT name, entries_json, updated_at FROM wheels WHERE guild_id = ? ORDER BY name COLLATE NOCASE').all(guildId)
      .map((row) => ({ ...row, entries: JSON.parse(row.entries_json) }));
  }

  deleteWheel(guildId, name) {
    return this.db.prepare('DELETE FROM wheels WHERE guild_id = ? AND name_key = ?').run(guildId, normalizeKey(name)).changes > 0;
  }

  saveReactionWheel(guildId, channelId, messageId, title, createdBy) {
    this.db.prepare(`
      INSERT INTO reaction_wheel_sessions
        (guild_id, channel_id, message_id, title, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(guildId, channelId, messageId, title, createdBy);
    return this.getReactionWheelByMessage(messageId);
  }

  getReactionWheelForCreator(guildId, createdBy) {
    return this.db.prepare(`
      SELECT * FROM reaction_wheel_sessions WHERE guild_id = ? AND created_by = ?
    `).get(guildId, createdBy) || null;
  }

  getReactionWheelByMessage(messageId) {
    return this.db.prepare('SELECT * FROM reaction_wheel_sessions WHERE message_id = ?').get(messageId) || null;
  }

  deleteReactionWheel(messageId) {
    return this.db.prepare('DELETE FROM reaction_wheel_sessions WHERE message_id = ?').run(messageId).changes > 0;
  }

  addTribute(record) {
    const result = this.db.prepare(`
      INSERT INTO tributes (guild_id, recipient_id, sender_id, amount_minor, currency, platform, logged_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.guildId,
      record.recipientId,
      record.senderId,
      record.amountMinor,
      record.currency,
      record.platform,
      record.loggedBy,
    );
    return this.db.prepare('SELECT * FROM tributes WHERE id = ?').get(result.lastInsertRowid);
  }

  getSentTotals(guildId, memberId) {
    return this.db.prepare(`
      SELECT currency, COALESCE(SUM(amount_minor), 0) AS total_minor, COUNT(*) AS count
      FROM tributes WHERE guild_id = ? AND sender_id = ?
      GROUP BY currency
    `).all(guildId, memberId);
  }

  saveStickyNote(guildId, channelId, content, updatedBy) {
    this.db.prepare(`
      INSERT INTO sticky_notes (guild_id, channel_id, content, updated_by)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, channel_id) DO UPDATE SET
        content = excluded.content,
        updated_by = excluded.updated_by,
        updated_at = CURRENT_TIMESTAMP
    `).run(guildId, channelId, content, updatedBy);
    return this.getStickyNote(guildId, channelId);
  }

  getStickyNote(guildId, channelId) {
    return this.db.prepare(`
      SELECT * FROM sticky_notes WHERE guild_id = ? AND channel_id = ?
    `).get(guildId, channelId) || null;
  }

  listStickyNotes() {
    return this.db.prepare('SELECT * FROM sticky_notes ORDER BY guild_id, channel_id').all();
  }

  setStickyMessageId(guildId, channelId, messageId) {
    return this.db.prepare(`
      UPDATE sticky_notes SET message_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE guild_id = ? AND channel_id = ?
    `).run(messageId, guildId, channelId).changes > 0;
  }

  deleteStickyNote(guildId, channelId) {
    return this.db.prepare(`
      DELETE FROM sticky_notes WHERE guild_id = ? AND channel_id = ?
    `).run(guildId, channelId).changes > 0;
  }
}

export function normalizeKey(value) {
  return String(value).trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}
