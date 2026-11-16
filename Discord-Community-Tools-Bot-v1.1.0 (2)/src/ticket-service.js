import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

const OPEN_BUTTON_ID = 'ticket:open';
const OPEN_MODAL_ID = 'ticket:open-modal';
const TRANSCRIPT_BUTTON_ID = 'ticket:transcript';
const CLOSE_BUTTON_ID = 'ticket:close-delete';
const MAX_TRANSCRIPT_BYTES = 7_500_000;

export function createTicketService({ database, client, isModerator }) {
  const closingChannels = new Set();
  const transcribingChannels = new Set();

  return {
    async handleCommand(interaction) {
      if (interaction.commandName !== 'ticket') return false;
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'panel') await postTicketPanel(interaction);
      else if (subcommand === 'open') await openTicket(interaction);
      else if (subcommand === 'transcript') await transcriptFromInteraction(interaction);
      else await closeFromInteraction(interaction);
      return true;
    },

    async handleComponent(interaction) {
      if (!interaction.isButton()) return false;
      if (interaction.customId === OPEN_BUTTON_ID) await showOpenTicketModal(interaction);
      else if (interaction.customId === TRANSCRIPT_BUTTON_ID) await transcriptFromInteraction(interaction);
      else if (interaction.customId === CLOSE_BUTTON_ID) await closeFromInteraction(interaction);
      else return false;
      return true;
    },

    async handleModal(interaction) {
      if (!interaction.isModalSubmit() || interaction.customId !== OPEN_MODAL_ID) return false;
      const rawType = interaction.fields.getTextInputValue('ticket_type').trim().toLocaleLowerCase('en-US');
      const type = ({ verification: 'verification', verify: 'verification', support: 'support', help: 'support', other: 'other' })[rawType];
      if (!type) return interaction.reply({ content: 'Ticket type must be `verification`, `support`, or `other`.', ephemeral: true });
      const subject = interaction.fields.getTextInputValue('ticket_subject').trim() || null;
      await openTicket(interaction, { type, subject });
      return true;
    },
  };

  async function postTicketPanel(interaction) {
    const settings = await database.getSettings(interaction.guildId);
    if (!isModerator(interaction, settings)) return interaction.reply({ content: 'Only configured moderators can post the ticket panel.', ephemeral: true });
    if (!settings.ticket_category_id || !settings.ticket_transcript_channel_id || !settings.moderator_role_id) {
      return interaction.reply({ content: 'Run `/setup roles` and `/setup tickets` before posting the ticket panel.', ephemeral: true });
    }
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0xB9B4FF).setTitle('Need Help?').setDescription('Press **Open Ticket** to create a private channel with the moderator team for verification, support, or another concern.').setFooter({ text: 'One open ticket per member' })],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(OPEN_BUTTON_ID).setLabel('Open Ticket').setStyle(ButtonStyle.Primary).setEmoji('🎫'),
      )],
    });
  }

  async function showOpenTicketModal(interaction) {
    return interaction.showModal(new ModalBuilder().setCustomId(OPEN_MODAL_ID).setTitle('Open a Ticket').addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder()
        .setCustomId('ticket_type')
        .setLabel('Type: verification, support, or other')
        .setStyle(TextInputStyle.Short)
        .setMinLength(4)
        .setMaxLength(20)
        .setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder()
        .setCustomId('ticket_subject')
        .setLabel('What do you need help with?')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(200)
        .setRequired(false)),
    ));
  }

  async function openTicket(interaction, override = null) {
    const settings = await database.getSettings(interaction.guildId);
    if (!settings.ticket_category_id || !settings.ticket_transcript_channel_id) {
      return interaction.reply({ content: 'An administrator must run `/setup tickets` first.', ephemeral: true });
    }
    if (!settings.moderator_role_id) {
      return interaction.reply({ content: 'An administrator must run `/setup roles` before tickets can be opened.', ephemeral: true });
    }
    const existing = await database.getOpenTicketByOwner(interaction.guildId, interaction.user.id);
    if (existing) {
      const channel = await interaction.guild.channels.fetch(existing.channel_id).catch(() => null);
      if (channel) return interaction.reply({ content: `You already have an open ticket: ${channel}.`, ephemeral: true });
      await database.closeTicket(interaction.guildId, existing.channel_id, client.user.id);
    }

    const category = await interaction.guild.channels.fetch(settings.ticket_category_id).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) {
      return interaction.reply({ content: 'The configured ticket category is unavailable. Ask an administrator to update `/setup tickets`.', ephemeral: true });
    }
    const botMember = interaction.guild.members.me;
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({ content: 'The bot needs Manage Channels before it can create tickets.', ephemeral: true });
    }

    const type = override ? override.type : interaction.options.getString('type', true);
    const subject = override ? override.subject : (interaction.options.getString('subject')?.trim() || null);
    await interaction.deferReply({ ephemeral: true });
    let channel;
    try {
      channel = await interaction.guild.channels.create({
        name: ticketChannelName(type, interaction.user.username, interaction.user.id),
        type: ChannelType.GuildText,
        parent: category.id,
        topic: `${type} ticket · Owner ${interaction.user.id}`,
        permissionOverwrites: [
          { id: interaction.guildId, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: interaction.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.EmbedLinks,
            ],
          },
          {
            id: settings.moderator_role_id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.ManageMessages,
            ],
          },
          {
            id: client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.ManageChannels,
            ],
          },
        ],
        reason: `Ticket opened by ${interaction.user.tag} (${interaction.user.id})`,
      });
      await database.createTicket(interaction.guildId, channel.id, interaction.user.id, type, subject);
    } catch (error) {
      if (channel) await channel.delete('Ticket setup failed').catch(() => {});
      throw error;
    }

    const typeLabel = ticketTypeLabel(type);
    await channel.send({
      content: `<@${interaction.user.id}> <@&${settings.moderator_role_id}>`,
      embeds: [new EmbedBuilder()
        .setColor(type === 'verification' ? 0xA8E6CF : 0xFFD3B6)
        .setTitle(`${typeLabel} Ticket`)
        .setDescription(subject || 'A moderator will be with you as soon as possible.')
        .addFields(
          { name: 'Opened by', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Type', value: typeLabel, inline: true },
        )
        .setFooter({ text: 'Only the moderator team can create transcripts or close this ticket.' })
        .setTimestamp()],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(TRANSCRIPT_BUTTON_ID).setLabel('Create Transcript').setStyle(ButtonStyle.Secondary).setEmoji('📄'),
        new ButtonBuilder().setCustomId(CLOSE_BUTTON_ID).setLabel('Close & Delete').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
      )],
      allowedMentions: { users: [interaction.user.id], roles: [settings.moderator_role_id] },
    });
    return interaction.editReply({ content: `Your private ${typeLabel.toLowerCase()} ticket is ready: ${channel}` });
  }

  async function transcriptFromInteraction(interaction) {
    const settings = await database.getSettings(interaction.guildId);
    if (!isModerator(interaction, settings)) {
      return interaction.reply({ content: 'Only configured moderators can create ticket transcripts.', ephemeral: true });
    }
    const ticket = await database.getOpenTicketByChannel(interaction.guildId, interaction.channelId);
    if (!ticket) return interaction.reply({ content: 'This channel is not an open ticket.', ephemeral: true });
    if (closingChannels.has(interaction.channelId) || transcribingChannels.has(interaction.channelId)) {
      return interaction.reply({ content: 'A transcript operation is already running for this ticket.', ephemeral: true });
    }
    transcribingChannels.add(interaction.channelId);
    await interaction.deferReply({ ephemeral: true });
    try {
      const result = await sendTranscript(interaction, settings, ticket, false);
      if (!result) return;
      return interaction.editReply({ content: `Transcript #${ticket.id} saved. The ticket remains open.` });
    } finally {
      transcribingChannels.delete(interaction.channelId);
    }
  }

  async function closeFromInteraction(interaction) {
    const settings = await database.getSettings(interaction.guildId);
    if (!isModerator(interaction, settings)) {
      return interaction.reply({ content: 'Only configured moderators can close tickets.', ephemeral: true });
    }
    const ticket = await database.getOpenTicketByChannel(interaction.guildId, interaction.channelId);
    if (!ticket) return interaction.reply({ content: 'This channel is not an open ticket.', ephemeral: true });
    if (closingChannels.has(interaction.channelId)) {
      return interaction.reply({ content: 'This ticket is already being closed.', ephemeral: true });
    }
    closingChannels.add(interaction.channelId);
    await interaction.deferReply({ ephemeral: true });
    try {
      const result = await sendTranscript(interaction, settings, ticket, true);
      if (!result) return;
      await database.closeTicket(interaction.guildId, interaction.channelId, interaction.user.id);
      await interaction.editReply({ content: 'Final transcript saved. This ticket is now closed and will be deleted.' });
      await interaction.channel.delete(`Ticket closed by ${interaction.user.tag} (${interaction.user.id})`);
    } finally {
      closingChannels.delete(interaction.channelId);
    }
  }

  async function sendTranscript(interaction, settings, ticket, isClosing) {
    const transcriptChannel = await interaction.guild.channels.fetch(settings.ticket_transcript_channel_id).catch(() => null);
    if (!transcriptChannel?.isTextBased()) {
      await interaction.editReply({ content: `The configured transcript channel is unavailable. The ticket was not ${isClosing ? 'closed' : 'changed'}.` });
      return false;
    }
    const permissions = transcriptChannel.permissionsFor(interaction.guild.members.me);
    if (!permissions?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.EmbedLinks,
    ])) {
      await interaction.editReply({ content: `The bot cannot send files in the transcript channel. The ticket was not ${isClosing ? 'closed' : 'changed'}.` });
      return false;
    }

    const messages = await fetchAllMessages(interaction.channel);
    const transcript = buildTicketTranscript({
      guildName: interaction.guild.name,
      channelName: interaction.channel.name,
      ticket,
      closedBy: interaction.user,
      actionLabel: isClosing ? 'Closed by' : 'Transcript created by',
      messages,
    });
    const filename = `ticket-${ticket.id}-${safeFilename(interaction.channel.name)}.txt`;
    await transcriptChannel.send({
      embeds: [new EmbedBuilder()
        .setColor(0xB9B4FF)
        .setTitle(`Ticket #${ticket.id} ${isClosing ? 'closed' : 'transcript snapshot'}`)
        .addFields(
          { name: 'Owner', value: `<@${ticket.owner_id}>`, inline: true },
          { name: 'Type', value: ticketTypeLabel(ticket.ticket_type), inline: true },
          { name: isClosing ? 'Closed by' : 'Created by', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Channel', value: `#${interaction.channel.name}`, inline: true },
          { name: 'Messages', value: String(messages.length), inline: true },
        )
        .setTimestamp()],
      files: [new AttachmentBuilder(Buffer.from(transcript, 'utf8'), { name: filename })],
      allowedMentions: { parse: [] },
    });
    return true;
  }
}

export async function fetchAllMessages(channel) {
  const messages = [];
  let before;
  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    messages.push(...batch.values());
    if (batch.size < 100) break;
    const oldest = batch.last();
    if (!oldest || oldest.id === before) break;
    before = oldest.id;
  }
  return messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

export function buildTicketTranscript({ guildName, channelName, ticket, closedBy, actionLabel = 'Closed by', messages }) {
  const header = [
    'Ticket Transcript',
    `Server: ${guildName}`,
    `Ticket: #${ticket.id}`,
    `Channel: #${channelName} (${ticket.channel_id})`,
    `Owner ID: ${ticket.owner_id}`,
    `Type: ${ticketTypeLabel(ticket.ticket_type)}`,
    `Subject: ${ticket.subject || 'Not provided'}`,
    `Opened: ${ticket.created_at}`,
    `${actionLabel}: ${closedBy.tag} (${closedBy.id})`,
    '',
  ];
  const lines = messages.map((message) => {
    const timestamp = new Date(message.createdTimestamp).toISOString();
    const author = message.author ? `${message.author.tag} (${message.author.id})` : 'Unknown author';
    const content = message.content?.trim() || '[No text content]';
    const attachments = [...(message.attachments?.values?.() || [])].map((item) => item.url);
    const embeds = (message.embeds || []).map((embed) => `[Embed: ${embed.title || embed.description || 'embedded content'}]`);
    return [`[${timestamp}] ${author}: ${content}`, ...attachments.map((url) => `  Attachment: ${url}`), ...embeds.map((item) => `  ${item}`)].join('\n');
  });
  let transcript = [...header, ...lines].join('\n');
  if (Buffer.byteLength(transcript, 'utf8') > MAX_TRANSCRIPT_BYTES) {
    const suffix = '\n\n[Transcript shortened because it exceeded Discord\'s upload limit.]';
    transcript = `${Buffer.from(transcript, 'utf8').subarray(0, MAX_TRANSCRIPT_BYTES - Buffer.byteLength(suffix)).toString('utf8')}${suffix}`;
  }
  return transcript;
}

export function ticketChannelName(type, username, userId) {
  const clean = String(username).toLocaleLowerCase('en-US').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'member';
  return `${type}-${clean}-${String(userId).slice(-4)}`.slice(0, 100);
}

function ticketTypeLabel(type) {
  return ({ verification: 'Verification', support: 'Support', other: 'Other' })[type] || 'Other';
}

function safeFilename(value) {
  return String(value).replace(/[^a-z0-9_-]/gi, '-').slice(0, 80);
}
