import 'dotenv/config';
import { createServer } from 'node:http';
import {
  AttachmentBuilder,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes,
} from 'discord.js';
import { commandData } from './commands.js';
import { BotDatabase } from './database.js';
import { resolveDatabasePath } from './database-path.js';
import { safelyReportInteractionError } from './interaction-utils.js';
import { REACTION_WHEEL_EMOJI, buildReactionWheelEntrants } from './reaction-wheel.js';
import { createTicketService } from './ticket-service.js';
import {
  formatMoney,
  summarizeSentTotals,
} from './tribute-utils.js';
import { parseWheelEntries, renderWheelGif, sanitizeWheelLabel } from './wheel-renderer.js';
import {
  BUILT_IN_WHEELS,
  getBuiltInWheel,
  getGroupTwoWheelMembers,
  isBuiltInWheelName,
} from './wheel-presets.js';

const requiredEnvironment = ['DISCORD_TOKEN', 'CLIENT_ID'];
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);
if (missingEnvironment.length > 0) {
  throw new Error(`Missing environment variables: ${missingEnvironment.join(', ')}`);
}

const databasePath = resolveDatabasePath();
const database = new BotDatabase(databasePath);
console.log(`Database ready at ${databasePath}`);
const STICKY_REFRESH_DELAY_MS = 800;
const STICKY_FOOTER_TEXT = 'Sticky note · Reposted to stay visible';
const wheelSpinsInProgress = new Set();
const reactionWheelSpinsInProgress = new Set();
const stickyChannelKeys = new Set();
const stickyMessageIds = new Map();
const stickyRefreshTimers = new Map();
const stickyRefreshChains = new Map();
const stickyPostsInProgress = new Set();
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User, Partials.GuildMember],
});
const ticketService = createTicketService({ database, client, isModerator });

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Connected as ${readyClient.user.tag}`);
  for (const note of await database.listStickyNotes()) {
    const key = stickyKey(note.guild_id, note.channel_id);
    stickyChannelKeys.add(key);
    if (note.message_id) stickyMessageIds.set(key, note.message_id);
  }
  await registerCommands();
});

client.on(Events.GuildCreate, async (guild) => {
  for (const note of (await database.listStickyNotes()).filter((item) => item.guild_id === guild.id)) {
    const key = stickyKey(note.guild_id, note.channel_id);
    stickyChannelKeys.add(key);
    if (note.message_id) stickyMessageIds.set(key, note.message_id);
  }
});

client.on(Events.GuildDelete, (guild) => {
  clearGuildStickyCache(guild.id);
});

client.on(Events.MessageCreate, (message) => {
  if (!message.guildId) return;
  const key = stickyKey(message.guildId, message.channelId);
  if (!stickyChannelKeys.has(key)) return;
  if (stickyMessageIds.get(key) === message.id) return;
  if (message.author.id === client.user?.id && stickyPostsInProgress.has(key)) return;
  scheduleStickyRefresh(message.guild, message.channelId);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      await ticketService.handleComponent(interaction);
      return;
    }
    if (interaction.isModalSubmit()) {
      await ticketService.handleModal(interaction);
      return;
    }
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction);
      return;
    }
    if (!interaction.isChatInputCommand() || !interaction.guildId) return;
    const subcommand = interaction.options.getSubcommand(false);
    console.log(`Command received: guild=${interaction.guildId} command=${interaction.commandName}${subcommand ? ` subcommand=${subcommand}` : ''}`);

    const handlers = {
      setup: handleSetup,
      verify: handleVerify,
      tribute: handleTribute,
      wheel: handleWheel,
      sticky: handleSticky,
    };
    const handler = handlers[interaction.commandName];
    if (handler) await handler(interaction);
    else if (!(await ticketService.handleCommand(interaction))) {
      await interaction.reply({ content: 'That command is not available.', ephemeral: true });
    }
  } catch (error) {
    console.error('Interaction failed:', error);
    await safelyReportInteractionError(interaction, error);
  }
});

client.on(Events.Error, (error) => console.error('Discord client error:', error));
client.on(Events.Warn, (warning) => console.warn('Discord client warning:', warning));

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commandData });
  console.log(`Registered ${commandData.length} global commands`);
}

async function handleSetup(interaction) {
  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: 'You need Manage Server to configure the bot.', ephemeral: true });
  }
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'roles') {
    const roles = {
      pendingGroupOne: interaction.options.getRole('pending_group_one'),
      verifiedGroupOne: interaction.options.getRole('verified_group_one', true),
      groupOneLabel: interaction.options.getString('group_one_label', true).trim(),
      pendingGroupTwo: interaction.options.getRole('pending_group_two'),
      verifiedGroupTwo: interaction.options.getRole('verified_group_two', true),
      groupTwoLabel: interaction.options.getString('group_two_label', true).trim(),
      moderator: interaction.options.getRole('moderator', true),
    };
    const roleList = [roles.pendingGroupOne, roles.verifiedGroupOne, roles.pendingGroupTwo, roles.verifiedGroupTwo, roles.moderator].filter(Boolean);
    if (new Set(roleList.map((role) => role.id)).size !== roleList.length) {
      return interaction.reply({ content: 'Each setup field must use a different Discord role.', ephemeral: true });
    }
    if (roleList.some((role) => role.id === interaction.guildId || role.managed)) {
      return interaction.reply({ content: 'Do not select @everyone or an integration-managed role.', ephemeral: true });
    }
    const botMember = interaction.guild.members.me;
    const managedRoles = [roles.pendingGroupOne, roles.verifiedGroupOne, roles.pendingGroupTwo, roles.verifiedGroupTwo].filter(Boolean);
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ content: 'Give the bot Manage Roles, then try again.', ephemeral: true });
    }
    if (managedRoles.some((role) => botMember.roles.highest.comparePositionTo(role) <= 0)) {
      return interaction.reply({ content: 'Move the bot role above every selected verification role.', ephemeral: true });
    }
    await database.setRoles(interaction.guildId, {
      ...roles,
      pendingGroupOne: roles.pendingGroupOne?.id || null,
      verifiedGroupOne: roles.verifiedGroupOne.id,
      pendingGroupTwo: roles.pendingGroupTwo?.id || null,
      verifiedGroupTwo: roles.verifiedGroupTwo.id,
      moderator: roles.moderator.id,
    });
    return interaction.reply({
      content: `Roles saved. Group One is **${escapeMarkdown(roles.groupOneLabel)}** and Group Two is **${escapeMarkdown(roles.groupTwoLabel)}**.`,
      ephemeral: true,
    });
  }

  if (subcommand === 'tributes') {
    const channel = interaction.options.getChannel('channel', true);
    const permissions = channel.permissionsFor(interaction.guild.members.me);
    if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      return interaction.reply({ content: `The bot needs View Channel, Send Messages, and Embed Links in ${channel}.`, ephemeral: true });
    }
    await database.setTributeChannel(interaction.guildId, channel.id);
    return interaction.reply({ content: `Tribute channel saved as ${channel}.`, ephemeral: true });
  }

  if (subcommand === 'tickets') {
    const category = interaction.options.getChannel('category', true);
    const transcriptChannel = interaction.options.getChannel('transcript_channel', true);
    const settings = await database.getSettings(interaction.guildId);
    if (!settings.moderator_role_id) {
      return interaction.reply({ content: 'Run `/setup roles` first so tickets know which moderator role can view them.', ephemeral: true });
    }
    const botMember = interaction.guild.members.me;
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({ content: 'Give the bot Manage Channels before configuring tickets.', ephemeral: true });
    }
    const transcriptPermissions = transcriptChannel.permissionsFor(botMember);
    if (!transcriptPermissions?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.AttachFiles,
    ])) {
      return interaction.reply({ content: `The bot needs View Channel, Send Messages, Embed Links, and Attach Files in ${transcriptChannel}.`, ephemeral: true });
    }
    await database.setTicketSettings(interaction.guildId, category.id, transcriptChannel.id);
    return interaction.reply({ content: `Tickets will be created under **${escapeMarkdown(category.name)}** and transcripts will be sent to ${transcriptChannel}.`, ephemeral: true });
  }

  const settings = await database.getSettings(interaction.guildId);
  return interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(0xE9C85D)
      .setTitle('Bot configuration')
      .addFields(
        { name: `Group One: ${settings.group_one_label}`, value: `${mentionRole(settings.pending_group_one_role_id)} → ${mentionRole(settings.verified_group_one_role_id)}` },
        { name: `Group Two: ${settings.group_two_label}`, value: `${mentionRole(settings.pending_group_two_role_id)} → ${mentionRole(settings.verified_group_two_role_id)}` },
        { name: 'Moderator', value: mentionRole(settings.moderator_role_id), inline: true },
        { name: 'Tribute channel', value: mentionChannel(settings.tribute_channel_id), inline: true },
        { name: 'Ticket category', value: mentionChannel(settings.ticket_category_id), inline: true },
        { name: 'Ticket transcripts', value: mentionChannel(settings.ticket_transcript_channel_id), inline: true },
      )],
    ephemeral: true,
  });
}

async function handleVerify(interaction) {
  const settings = await database.getSettings(interaction.guildId);
  if (!isModerator(interaction, settings)) {
    return interaction.reply({ content: 'Only configured moderators can verify members.', ephemeral: true });
  }
  const group = interaction.options.getSubcommand() === 'group-two' ? 'group_two' : 'group_one';
  const pendingRoleId = group === 'group_two' ? settings.pending_group_two_role_id : settings.pending_group_one_role_id;
  const verifiedRoleId = group === 'group_two' ? settings.verified_group_two_role_id : settings.verified_group_one_role_id;
  const label = group === 'group_two' ? settings.group_two_label : settings.group_one_label;
  if (!verifiedRoleId) {
    return interaction.reply({ content: 'An administrator must run `/setup roles` first.', ephemeral: true });
  }
  const user = interaction.options.getUser('member', true);
  const member = await interaction.guild.members.fetch(user.id);
  if (member.user.bot) return interaction.reply({ content: 'Bots cannot be verified.', ephemeral: true });
  if (pendingRoleId) await member.roles.remove(pendingRoleId);
  await member.roles.add(verifiedRoleId);
  return interaction.reply({ content: `${member} is now verified as **${escapeMarkdown(label)}**.`, ephemeral: true });
}

async function handleTribute(interaction) {
  const settings = await database.getSettings(interaction.guildId);
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'log') {
    if (!settings.tribute_channel_id) return interaction.reply({ content: 'An administrator must run `/setup tributes` first.', ephemeral: true });
    if (interaction.channelId !== settings.tribute_channel_id) return interaction.reply({ content: `Tributes must be logged in <#${settings.tribute_channel_id}>.`, ephemeral: true });
    if (!settings.verified_group_two_role_id || !interaction.member.roles.cache.has(settings.verified_group_two_role_id)) {
      return interaction.reply({ content: `Only verified ${settings.group_two_label} members can log tributes.`, ephemeral: true });
    }
    const senderUser = interaction.options.getUser('sender', true);
    const sender = await interaction.guild.members.fetch(senderUser.id);
    if (sender.user.bot || !settings.verified_group_one_role_id || !sender.roles.cache.has(settings.verified_group_one_role_id)) {
      return interaction.reply({ content: `The sender must be a verified ${settings.group_one_label} member.`, ephemeral: true });
    }
    const amount = interaction.options.getNumber('amount', true);
    const currency = interaction.options.getString('currency', true);
    const platform = interaction.options.getString('platform', true).trim();
    const amountMinor = Math.round(amount * 100);
    const record = await database.addTribute({
      guildId: interaction.guildId,
      recipientId: interaction.user.id,
      senderId: sender.id,
      amountMinor,
      currency,
      platform,
      loggedBy: interaction.user.id,
    });
    await interaction.reply({
      content: `Tribute #${record.id} recorded and posted.`,
      ephemeral: true,
    });
    return interaction.channel.send({
      content: `💸 ${interaction.member} recorded a **${formatMoney(amountMinor, currency)}** tribute from ${sender} via **${escapeMarkdown(platform)}** · ID: \`${record.id}\` 💸`,
      allowedMentions: { users: [interaction.user.id, sender.id] },
    });
  }

  if (subcommand === 'totals') {
    const user = interaction.options.getUser('member') || interaction.user;
    const summary = summarizeSentTotals(await database.getSentTotals(interaction.guildId, user.id));
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xE9C85D)
        .setTitle(`${settings.group_one_label} tribute totals`)
        .setDescription(`${user}`)
        .addFields(
          { name: 'USD', value: formatMoney(summary.usdMinor, 'USD'), inline: true },
          { name: 'GBP', value: formatMoney(summary.gbpMinor, 'GBP'), inline: true },
          { name: 'Converted USD', value: formatMoney(summary.convertedUsdMinor, 'USD'), inline: true },
          { name: 'Tributes', value: String(summary.count), inline: true },
        )],
    });
  }

  return interaction.reply({ content: 'That tribute command is not available.', ephemeral: true });
}

async function handleSticky(interaction) {
  const settings = await database.getSettings(interaction.guildId);
  if (!isModerator(interaction, settings)) {
    return interaction.reply({ content: 'Only configured moderators can manage sticky notes.', ephemeral: true });
  }

  const channel = interaction.channel;
  if (!channel?.isTextBased() || !channel.messages) {
    return interaction.reply({ content: 'Sticky notes can only be used in a server text channel.', ephemeral: true });
  }

  const subcommand = interaction.options.getSubcommand();
  const key = stickyKey(interaction.guildId, channel.id);
  if (subcommand === 'set') {
    const permissions = channel.permissionsFor(interaction.guild.members.me);
    const requiredPermissions = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.ReadMessageHistory,
    ];
    if (!permissions?.has(requiredPermissions)) {
      return interaction.reply({
        content: 'The bot needs View Channel, Send Messages, Embed Links, and Read Message History here.',
        ephemeral: true,
      });
    }
    const content = interaction.options.getString('message', true).trim();
    if (!content) return interaction.reply({ content: 'A sticky note cannot be blank.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    await stopStickyRefresh(key);
    await database.saveStickyNote(interaction.guildId, channel.id, content, interaction.user.id);
    stickyChannelKeys.add(key);
    await runStickyRefresh(interaction.guild, channel.id);
    return interaction.editReply({ content: `Sticky note saved in ${channel}.` });
  }

  if (subcommand === 'show') {
    const note = await database.getStickyNote(interaction.guildId, channel.id);
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xA8E6CF)
        .setTitle(`Saved sticky note for #${channel.name}`)
        .setDescription(note?.content || 'No sticky note is configured in this channel.')],
      allowedMentions: { parse: [] },
      ephemeral: true,
    });
  }

  await stopStickyRefresh(key);
  const note = await database.getStickyNote(interaction.guildId, channel.id);
  if (!note) {
    return interaction.reply({ content: 'This channel does not have a sticky note.', ephemeral: true });
  }
  await deleteStickyMessage(interaction.guild, note);
  await database.deleteStickyNote(interaction.guildId, channel.id);
  clearStickyCacheKey(key);
  return interaction.reply({ content: `Sticky note removed from ${channel}.`, ephemeral: true });
}

function scheduleStickyRefresh(guild, channelId) {
  const key = stickyKey(guild.id, channelId);
  const existingTimer = stickyRefreshTimers.get(key);
  if (existingTimer) clearTimeout(existingTimer);
  const timer = setTimeout(() => {
    stickyRefreshTimers.delete(key);
    void runStickyRefresh(guild, channelId).catch((error) => {
      console.error(`Could not refresh sticky note in channel ${channelId}:`, error);
    });
  }, STICKY_REFRESH_DELAY_MS);
  stickyRefreshTimers.set(key, timer);
}

function runStickyRefresh(guild, channelId) {
  const key = stickyKey(guild.id, channelId);
  const previous = stickyRefreshChains.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => refreshStickyNote(guild, channelId));
  stickyRefreshChains.set(key, current);
  const cleanup = () => {
    if (stickyRefreshChains.get(key) === current) stickyRefreshChains.delete(key);
  };
  current.then(cleanup, cleanup);
  return current;
}

async function refreshStickyNote(guild, channelId) {
  const key = stickyKey(guild.id, channelId);
  const note = await database.getStickyNote(guild.id, channelId);
  if (!note) {
    clearStickyCacheKey(key);
    return null;
  }

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.messages) throw new Error('The sticky-note channel is unavailable.');
  await deleteStickyMessage(guild, note);
  stickyPostsInProgress.add(key);
  try {
    const posted = await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(0xA8E6CF)
        .setTitle('📌 Sticky Note')
        .setDescription(note.content)
        .setFooter({ text: STICKY_FOOTER_TEXT })],
      allowedMentions: { parse: [] },
    });
    await database.setStickyMessageId(guild.id, channelId, posted.id);
    stickyMessageIds.set(key, posted.id);
    return posted;
  } finally {
    stickyPostsInProgress.delete(key);
  }
}

async function deleteStickyMessage(guild, note) {
  if (!note?.message_id) return false;
  const channel = await guild.channels.fetch(note.channel_id).catch(() => null);
  if (!channel?.isTextBased() || !channel.messages) return false;
  const message = await channel.messages.fetch(note.message_id).catch(() => null);
  if (!message) return false;
  await message.delete().catch(() => null);
  return true;
}

async function removeGuildStickyMessages(guild) {
  const notes = (await database.listStickyNotes()).filter((note) => note.guild_id === guild.id);
  await Promise.all(notes.map((note) => deleteStickyMessage(guild, note)));
}

async function stopGuildStickyRefreshes(guildId) {
  const keys = new Set([
    ...[...stickyRefreshTimers.keys()].filter((key) => key.startsWith(`${guildId}:`)),
    ...[...stickyRefreshChains.keys()].filter((key) => key.startsWith(`${guildId}:`)),
  ]);
  await Promise.all([...keys].map((key) => stopStickyRefresh(key)));
}

async function stopStickyRefresh(key) {
  const timer = stickyRefreshTimers.get(key);
  if (timer) clearTimeout(timer);
  stickyRefreshTimers.delete(key);
  const active = stickyRefreshChains.get(key);
  if (active) await active.catch(() => {});
}

function clearGuildStickyCache(guildId) {
  for (const key of [...stickyChannelKeys]) {
    if (key.startsWith(`${guildId}:`)) clearStickyCacheKey(key);
  }
}

function clearStickyCacheKey(key) {
  stickyChannelKeys.delete(key);
  stickyMessageIds.delete(key);
  const timer = stickyRefreshTimers.get(key);
  if (timer) clearTimeout(timer);
  stickyRefreshTimers.delete(key);
  stickyRefreshChains.delete(key);
  stickyPostsInProgress.delete(key);
}

function stickyKey(guildId, channelId) {
  return `${guildId}:${channelId}`;
}

async function handleWheel(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const settings = await database.getSettings(interaction.guildId);

  if (subcommand === 'reaction-open') return handleReactionWheelOpen(interaction);
  if (subcommand === 'run') return handleReactionWheelSpin(interaction);
  if (subcommand === 'reaction-cancel') return handleReactionWheelCancel(interaction, settings);

  if (subcommand === 'create') {
    if (!isModerator(interaction, settings)) return interaction.reply({ content: 'Only configured moderators can create wheels.', ephemeral: true });
    const name = interaction.options.getString('name', true).trim();
    if (isBuiltInWheelName(name)) return interaction.reply({ content: `**${escapeMarkdown(name)}** is reserved for a built-in wheel.`, ephemeral: true });
    const entries = parseWheelEntries(interaction.options.getString('entries', true));
    await database.saveWheel(interaction.guildId, name, entries, interaction.user.id);
    return interaction.reply({ content: `Saved **${escapeMarkdown(name)}** with ${entries.length} entries.` });
  }
  if (subcommand === 'list') {
    const wheels = await database.listWheels(interaction.guildId);
    const builtIn = BUILT_IN_WHEELS.map((wheel) => wheel.type === 'amounts'
      ? `• **${wheel.name}** - ${wheel.entries.map((entry) => `$${entry}`).join(', ')}`
      : `• **${wheel.name}** - everyone with the configured verified Group Two role`).join('\n');
    const custom = wheels.length ? wheels.map((wheel) => `• **${escapeMarkdown(wheel.name)}** - ${wheel.entries.length} entries`).join('\n') : 'No custom wheels saved yet.';
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xE9C85D).setTitle('Available wheels').addFields({ name: 'Built-in', value: builtIn }, { name: 'Custom', value: custom })] });
  }
  const name = interaction.options.getString('name', true);
  if (subcommand === 'delete') {
    if (!isModerator(interaction, settings)) return interaction.reply({ content: 'Only configured moderators can delete wheels.', ephemeral: true });
    if (isBuiltInWheelName(name)) return interaction.reply({ content: 'Built-in wheels cannot be deleted.', ephemeral: true });
    const deleted = await database.deleteWheel(interaction.guildId, name);
    return interaction.reply({ content: deleted ? `Deleted **${escapeMarkdown(name)}**.` : `No wheel named **${escapeMarkdown(name)}** was found.`, ephemeral: true });
  }
  const builtInWheel = getBuiltInWheel(name);
  const savedWheel = builtInWheel ? null : await database.getWheel(interaction.guildId, name);
  if (!builtInWheel && !savedWheel) return interaction.reply({ content: `No wheel named **${escapeMarkdown(name)}** was found.`, ephemeral: true });
  if (wheelSpinsInProgress.has(interaction.guildId)) return interaction.reply({ content: 'A wheel is already spinning in this server.', ephemeral: true });

  wheelSpinsInProgress.add(interaction.guildId);
  await interaction.deferReply();
  try {
    const wheelName = savedWheel?.name || builtInWheel.name;
    let entries = savedWheel?.entries || builtInWheel.entries;
    let groupMembers = null;
    if (builtInWheel?.type === 'verified_group_two_role') {
      if (!settings.verified_group_two_role_id) return interaction.editReply('An administrator must run `/setup roles` first.');
      await interaction.guild.members.fetch();
      const role = interaction.guild.roles.cache.get(settings.verified_group_two_role_id);
      if (!role) return interaction.editReply('The configured Group Two role could not be found.');
      groupMembers = getGroupTwoWheelMembers(role.members.values());
      if (groupMembers.length < 2) return interaction.editReply('The Group Two wheel needs at least two non-bot members.');
      entries = groupMembers.map((member, index) => sanitizeWheelLabel(
        member.displayName,
        member.user.username || `${settings.group_two_label} ${index + 1}`,
      ));
    }
    await interaction.editReply({ content: `🎯 Spinning **${escapeMarkdown(wheelName)}**…` });
    const startedAt = Date.now();
    console.log(`Wheel render started: guild=${interaction.guildId} wheel=${JSON.stringify(wheelName)} entries=${entries.length}`);
    const rendered = renderWheelGif(entries);
    console.log(`Wheel render finished: guild=${interaction.guildId} duration_ms=${Date.now() - startedAt} bytes=${rendered.buffer.length}`);
    const result = groupMembers ? `${groupMembers[rendered.selectedIndex]}` : `**${escapeMarkdown(rendered.result)}**`;
    return interaction.editReply({
      content: null,
      embeds: [new EmbedBuilder().setColor(0xE9C85D).setTitle(wheelName).addFields(
        { name: 'Winner', value: result, inline: true },
        { name: 'Entries', value: String(entries.length), inline: true },
      ).setImage('attachment://community-wheel.gif').setFooter({ text: 'Animated community wheel' })],
      files: [new AttachmentBuilder(rendered.buffer, { name: 'community-wheel.gif' })],
    });
  } finally {
    wheelSpinsInProgress.delete(interaction.guildId);
  }
}

async function handleReactionWheelOpen(interaction) {
  const active = await database.getReactionWheelForCreator(interaction.guildId, interaction.user.id);
  if (active) {
    return interaction.reply({
      content: `You already have an active reaction signup: ${reactionWheelMessageUrl(active)}. Spin or cancel it first.`,
      ephemeral: true,
    });
  }

  const channel = interaction.channel;
  if (!channel?.isTextBased() || !channel.messages) {
    return interaction.reply({ content: 'Open the reaction wheel in a server text channel.', ephemeral: true });
  }
  const permissions = channel.permissionsFor(interaction.guild.members.me);
  const requiredPermissions = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.ReadMessageHistory,
  ];
  if (!permissions?.has(requiredPermissions)) {
    return interaction.reply({
      content: 'The bot needs View Channel, Send Messages, Embed Links, Attach Files, Add Reactions, and Read Message History here.',
      ephemeral: true,
    });
  }

  const ownerLabel = sanitizeWheelLabel(
    interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
    interaction.user.username,
  );
  const title = interaction.options.getString('title')?.trim() || `${ownerLabel}'s Reaction Wheel`.slice(0, 80);
  await interaction.reply({ embeds: [reactionWheelSignupEmbed(title, 'open', null, interaction.user.id)] });
  const message = await interaction.fetchReply();
  await message.react(REACTION_WHEEL_EMOJI);
  try {
    await database.saveReactionWheel(interaction.guildId, channel.id, message.id, title, interaction.user.id);
  } catch (error) {
    console.error('Could not save reaction wheel signup:', error);
    await message.edit({ embeds: [reactionWheelSignupEmbed(title, 'cancelled', null, interaction.user.id)] }).catch(console.error);
    return interaction.followUp({ content: 'You already have an active reaction signup. Spin or cancel it before opening another.', ephemeral: true });
  }
}

async function handleReactionWheelSpin(interaction) {
  const session = await database.getReactionWheelForCreator(interaction.guildId, interaction.user.id);
  if (!session) return interaction.reply({ content: 'You do not have an active reaction signup. Run `/wheel reaction-open` first.', ephemeral: true });
  if (wheelSpinsInProgress.has(interaction.guildId)) {
    return interaction.reply({ content: 'A wheel is already spinning in this server.', ephemeral: true });
  }

  wheelSpinsInProgress.add(interaction.guildId);
  reactionWheelSpinsInProgress.add(session.message_id);
  await interaction.deferReply();
  try {
    const signupMessage = await fetchReactionWheelMessage(interaction.guild, session).catch(() => null);
    if (!signupMessage) {
      await database.deleteReactionWheel(session.message_id);
      return interaction.editReply('I could not access your signup message, so I cleared it. Run `/wheel reaction-open` to make a new one.');
    }
    const reaction = signupMessage.reactions.cache.find((item) =>
      normalizeEmoji(item.emoji.name) === normalizeEmoji(REACTION_WHEEL_EMOJI));
    if (!reaction) {
      return interaction.editReply(`Nobody has reacted with ${REACTION_WHEEL_EMOJI} yet.`);
    }

    const reactingUsers = await fetchAllReactionUsers(reaction);
    await interaction.guild.members.fetch();
    const currentMembers = new Map(interaction.guild.members.cache.map((member) => [member.id, member]));
    const currentUsers = reactingUsers.filter((user) => currentMembers.has(user.id));
    const entrants = buildReactionWheelEntrants(currentUsers, currentMembers);
    if (entrants.length < 2) {
      return interaction.editReply('Your reaction wheel needs at least two non-bot members. The signup is still open so more people can join.');
    }

    const entries = entrants.map((entrant) => entrant.label);
    await interaction.editReply({ content: `🎯 Spinning **${escapeMarkdown(session.title)}** with ${entries.length} entries…` });
    const startedAt = Date.now();
    console.log(`Reaction wheel render started: guild=${interaction.guildId} entries=${entries.length}`);
    const rendered = renderWheelGif(entries);
    console.log(`Reaction wheel render finished: guild=${interaction.guildId} duration_ms=${Date.now() - startedAt} bytes=${rendered.buffer.length}`);
    const winner = entrants[rendered.selectedIndex];
    await interaction.editReply({
      content: null,
      embeds: [new EmbedBuilder().setColor(0xE9C85D).setTitle(session.title).addFields(
        { name: 'Winner', value: `<@${winner.userId}>`, inline: true },
        { name: 'Entries', value: String(entries.length), inline: true },
      ).setImage('attachment://community-reaction-wheel.gif').setFooter({ text: 'One-time reaction wheel' })],
      files: [new AttachmentBuilder(rendered.buffer, { name: 'community-reaction-wheel.gif' })],
      allowedMentions: { users: [winner.userId] },
    });
    await signupMessage.edit({ embeds: [reactionWheelSignupEmbed(session.title, 'spun', winner.userId, session.created_by)] }).catch(console.error);
    await database.deleteReactionWheel(session.message_id);
  } finally {
    reactionWheelSpinsInProgress.delete(session.message_id);
    wheelSpinsInProgress.delete(interaction.guildId);
  }
}

async function handleReactionWheelCancel(interaction, settings) {
  const target = interaction.options.getUser('member') || interaction.user;
  if (target.id !== interaction.user.id && !isModerator(interaction, settings)) {
    return interaction.reply({ content: 'Only configured moderators can cancel another member\'s reaction wheel.', ephemeral: true });
  }
  const session = await database.getReactionWheelForCreator(interaction.guildId, target.id);
  if (!session) {
    const subject = target.id === interaction.user.id ? 'You do not have' : `${target} does not have`;
    return interaction.reply({ content: `${subject} an active reaction signup.`, ephemeral: true });
  }
  if (reactionWheelSpinsInProgress.has(session.message_id)) {
    return interaction.reply({ content: 'That reaction wheel is already spinning and can no longer be cancelled.', ephemeral: true });
  }
  await database.deleteReactionWheel(session.message_id);
  const signupMessage = await fetchReactionWheelMessage(interaction.guild, session).catch(() => null);
  if (signupMessage) await signupMessage.edit({ embeds: [reactionWheelSignupEmbed(session.title, 'cancelled', null, session.created_by)] }).catch(console.error);
  return interaction.reply({ content: 'The reaction signup was cancelled without spinning.', ephemeral: true });
}

function reactionWheelSignupEmbed(title, status, winnerId = null, creatorId = null) {
  if (status === 'spun') {
    return new EmbedBuilder()
      .setColor(0xD8AF3D)
      .setTitle(`🎟️ ${title}`)
      .setDescription(`This signup is closed. Winner: <@${winnerId}>`)
      .setFooter({ text: 'This one-time reaction wheel has been used.' });
  }
  if (status === 'cancelled') {
    return new EmbedBuilder()
      .setColor(0xB7BEC9)
      .setTitle(`🎟️ ${title}`)
      .setDescription('This reaction signup was cancelled without spinning.');
  }
  return new EmbedBuilder()
    .setColor(0xE9C85D)
    .setTitle(`🎟️ ${title}`)
    .setDescription(`React with ${REACTION_WHEEL_EMOJI} to add yourself to this one-time wheel.${creatorId ? `\n\nOpened by <@${creatorId}>.` : ''}`)
    .setFooter({ text: 'One entry per person · The person who opened it will spin it.' });
}

async function fetchReactionWheelMessage(guild, session) {
  const channel = await guild.channels.fetch(session.channel_id);
  if (!channel?.isTextBased() || !channel.messages) throw new Error('Reaction wheel channel is unavailable.');
  return channel.messages.fetch(session.message_id);
}

async function fetchAllReactionUsers(reaction) {
  const users = new Map();
  let after;
  while (true) {
    const batch = await reaction.users.fetch({ limit: 100, ...(after ? { after } : {}) });
    for (const user of batch.values()) users.set(user.id, user);
    if (batch.size < 100) break;
    const lastUser = batch.last();
    if (!lastUser || lastUser.id === after) break;
    after = lastUser.id;
  }
  return [...users.values()];
}

function reactionWheelMessageUrl(session) {
  return `https://discord.com/channels/${session.guild_id}/${session.channel_id}/${session.message_id}`;
}

function normalizeEmoji(value) {
  return String(value || '').replaceAll('\uFE0F', '');
}

async function handleAutocomplete(interaction) {
  if (interaction.commandName !== 'wheel' || !interaction.guildId) return interaction.respond([]);
  const focused = interaction.options.getFocused().toLocaleLowerCase('en-US');
  const savedWheels = await database.listWheels(interaction.guildId);
  const choices = [...BUILT_IN_WHEELS.map((wheel) => wheel.name), ...savedWheels.map((wheel) => wheel.name)]
    .filter((name) => name.toLocaleLowerCase('en-US').includes(focused))
    .slice(0, 25)
    .map((name) => ({ name, value: name }));
  return interaction.respond(choices);
}

function isModerator(interaction, settings) {
  return interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)
    || Boolean(settings.moderator_role_id && interaction.member.roles.cache.has(settings.moderator_role_id));
}

function mentionRole(id) {
  return id ? `<@&${id}>` : 'Not configured';
}

function mentionChannel(id) {
  return id ? `<#${id}>` : 'Not configured';
}

function escapeMarkdown(value) {
  return String(value).replace(/([\\`*_{}\[\]()<>#+\-.!|])/g, '\\$1');
}

const port = Number(process.env.PORT || 3000);
createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ok: true, botReady: client.isReady(), guilds: client.guilds.cache.size }));
}).listen(port, '0.0.0.0', () => console.log(`Health server listening on ${port}`));

const shutdown = async (signal) => {
  console.log(`Received ${signal}; shutting down.`);
  client.destroy();
  await database.close();
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

await client.login(process.env.DISCORD_TOKEN);


