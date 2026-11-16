import { MessageFlags } from 'discord.js';

export async function safelyReportInteractionError(interaction, error, logger = console) {
  const response = {
    content: `Something went wrong: ${error?.message || 'An unexpected error occurred.'}`,
  };

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(response);
    } else {
      await interaction.reply({ ...response, flags: MessageFlags.Ephemeral });
    }
  } catch (responseError) {
    if (responseError?.code === 10062) {
      logger.warn('Could not report the command error because Discord had already expired the interaction.');
      return;
    }
    logger.error('Could not report the command error to Discord:', responseError);
  }
}
