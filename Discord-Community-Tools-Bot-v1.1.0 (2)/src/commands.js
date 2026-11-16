import {
  ChannelType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

const currencyChoices = [
  { name: 'USD ($)', value: 'USD' },
  { name: 'GBP (£)', value: 'GBP' },
];

export const commandBuilders = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure the community bot for this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand
      .setName('roles')
      .setDescription('Choose two verification tracks and a moderator role')
      .addRoleOption((option) => option.setName('verified_group_one').setDescription('Role given by /verify group-one').setRequired(true))
      .addStringOption((option) => option.setName('group_one_label').setDescription('Display label, such as Sub or Member').setMaxLength(30).setRequired(true))
      .addRoleOption((option) => option.setName('verified_group_two').setDescription('Role given by /verify group-two').setRequired(true))
      .addStringOption((option) => option.setName('group_two_label').setDescription('Display label, such as Domme or Creator').setMaxLength(30).setRequired(true))
      .addRoleOption((option) => option.setName('moderator').setDescription('Role allowed to manage protected features').setRequired(true))
      .addRoleOption((option) => option.setName('pending_group_one').setDescription('Optional role removed by /verify group-one'))
      .addRoleOption((option) => option.setName('pending_group_two').setDescription('Optional role removed by /verify group-two')))
    .addSubcommand((subcommand) => subcommand
      .setName('tributes')
      .setDescription('Choose the channel where tributes are logged')
      .addChannelOption((option) => option.setName('channel').setDescription('Tribute log channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('tickets')
      .setDescription('Configure private tickets')
      .addChannelOption((option) => option.setName('category').setDescription('Category where private tickets are created').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
      .addChannelOption((option) => option.setName('transcript_channel').setDescription('Channel that receives ticket transcripts').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('show').setDescription('Show the current configuration')),

  new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Verify a server member')
    .addSubcommand((subcommand) => subcommand.setName('group-one').setDescription('Verify a member through Group One').addUserOption((option) => option.setName('member').setDescription('Member to verify').setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('group-two').setDescription('Verify a member through Group Two').addUserOption((option) => option.setName('member').setDescription('Member to verify').setRequired(true))),

  new SlashCommandBuilder()
    .setName('tribute')
    .setDescription('Log and total community tributes')
    .addSubcommand((subcommand) => subcommand
      .setName('log')
      .setDescription('Record a tribute received by a verified Group Two member')
      .addUserOption((option) => option.setName('sender').setDescription('Verified Group One member who sent it').setRequired(true))
      .addNumberOption((option) => option.setName('amount').setDescription('Amount received').setMinValue(0.01).setMaxValue(1000000).setRequired(true))
      .addStringOption((option) => option.setName('currency').setDescription('Currency used').addChoices(...currencyChoices).setRequired(true))
      .addStringOption((option) => option.setName('platform').setDescription('Where it was sent').setMinLength(1).setMaxLength(80).setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('totals')
      .setDescription('Show how much a Group One member has sent')
      .addUserOption((option) => option.setName('member').setDescription('Member to review; defaults to you'))),

  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Open and manage private tickets')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((subcommand) => subcommand.setName('panel').setDescription('Post a reusable Open Ticket button'))
    .addSubcommand((subcommand) => subcommand
      .setName('open')
      .setDescription('Open a private ticket')
      .addStringOption((option) => option.setName('type').setDescription('What this ticket is for').addChoices(
        { name: 'Verification', value: 'verification' },
        { name: 'Support', value: 'support' },
        { name: 'Other', value: 'other' },
      ).setRequired(true))
      .addStringOption((option) => option.setName('subject').setDescription('Briefly explain what you need').setMinLength(1).setMaxLength(200)))
    .addSubcommand((subcommand) => subcommand.setName('transcript').setDescription('Save a transcript without closing this ticket'))
    .addSubcommand((subcommand) => subcommand.setName('close').setDescription('Save a transcript, close, and delete this ticket')),

  new SlashCommandBuilder()
    .setName('sticky')
    .setDescription('Manage a message that stays at the bottom of this channel')
    .addSubcommand((subcommand) => subcommand.setName('set').setDescription('Set or replace this channel\'s sticky note').addStringOption((option) => option.setName('message').setDescription('Message to keep at the bottom').setMinLength(1).setMaxLength(1800).setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('remove').setDescription('Remove this channel\'s sticky note'))
    .addSubcommand((subcommand) => subcommand.setName('show').setDescription('Privately show this channel\'s saved sticky note')),

  new SlashCommandBuilder()
    .setName('wheel')
    .setDescription('Create and spin animated wheels')
    .addSubcommand((subcommand) => subcommand.setName('create').setDescription('Create or replace a custom wheel').addStringOption((option) => option.setName('name').setDescription('Wheel name').setMinLength(1).setMaxLength(40).setRequired(true)).addStringOption((option) => option.setName('entries').setDescription('Separate entries with commas, pipes, or new lines').setMinLength(3).setMaxLength(1800).setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('spin').setDescription('Spin a built-in or custom wheel').addStringOption((option) => option.setName('name').setDescription('Built-in or saved wheel name').setAutocomplete(true).setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('list').setDescription('List built-in and custom wheels'))
    .addSubcommand((subcommand) => subcommand.setName('delete').setDescription('Delete a custom wheel').addStringOption((option) => option.setName('name').setDescription('Saved wheel name').setAutocomplete(true).setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('reaction-open').setDescription('Post a one-time reaction wheel signup').addStringOption((option) => option.setName('title').setDescription('Optional title shown on the signup and wheel').setMinLength(1).setMaxLength(80)))
    .addSubcommand((subcommand) => subcommand.setName('run').setDescription('Close and spin your reaction wheel using everyone who joined'))
    .addSubcommand((subcommand) => subcommand.setName('reaction-cancel').setDescription('Cancel your active reaction wheel').addUserOption((option) => option.setName('member').setDescription('Moderators may cancel another member\'s wheel'))),
];

export const commandData = commandBuilders.map((command) => command.toJSON());
