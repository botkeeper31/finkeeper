import { sanitizeWheelLabel } from './wheel-renderer.js';

export const REACTION_WHEEL_EMOJI = '🎟️';

export function buildReactionWheelEntrants(users, membersById) {
  return [...users]
    .filter((user) => !user.bot)
    .map((user, index) => {
      const member = membersById.get(user.id);
      const fallback = user.username || `Member ${index + 1}`;
      const displayName = member?.displayName || user.globalName || fallback;
      return {
        userId: user.id,
        label: sanitizeWheelLabel(displayName, fallback),
      };
    })
    .sort((left, right) =>
      left.label.localeCompare(right.label, 'en-US', { sensitivity: 'base' })
      || left.userId.localeCompare(right.userId));
}
