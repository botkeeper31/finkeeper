export const BUILT_IN_WHEELS = Object.freeze([
  Object.freeze({ name: 'Group Two', type: 'verified_group_two_role', entries: null }),
  Object.freeze({ name: 'Small', type: 'amounts', entries: Object.freeze(['5', '10', '15', '20', '25']) }),
  Object.freeze({ name: 'Medium', type: 'amounts', entries: Object.freeze(['25', '30', '35', '40', '45', '50', '55']) }),
  Object.freeze({
    name: 'Large',
    type: 'amounts',
    entries: Object.freeze(Array.from({ length: 19 }, (_, index) => String(10 + (index * 5)))),
  }),
]);

export function getBuiltInWheel(name) {
  const key = normalizePresetName(name);
  return BUILT_IN_WHEELS.find((wheel) => normalizePresetName(wheel.name) === key) || null;
}

export function isBuiltInWheelName(name) {
  return Boolean(getBuiltInWheel(name));
}

export function getGroupTwoWheelMembers(members) {
  return [...members]
    .filter((member) => !member.user.bot)
    .sort((left, right) =>
      left.displayName.localeCompare(right.displayName, 'en-US', { sensitivity: 'base' })
      || left.id.localeCompare(right.id));
}

function normalizePresetName(name) {
  return String(name).trim().toLocaleLowerCase('en-US');
}
