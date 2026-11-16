import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILT_IN_WHEELS,
  getBuiltInWheel,
  getGroupTwoWheelMembers,
  isBuiltInWheelName,
} from '../src/wheel-presets.js';

test('defines the requested Small, Medium, and Large amount wheels', () => {
  assert.deepEqual(getBuiltInWheel('Small').entries, ['5', '10', '15', '20', '25']);
  assert.deepEqual(getBuiltInWheel('Medium').entries, ['25', '30', '35', '40', '45', '50', '55']);
  assert.deepEqual(getBuiltInWheel('Large').entries, [
    '10', '15', '20', '25', '30', '35', '40', '45', '50', '55',
    '60', '65', '70', '75', '80', '85', '90', '95', '100',
  ]);
});

test('reserves all built-in wheel names case-insensitively', () => {
  assert.deepEqual(BUILT_IN_WHEELS.map((wheel) => wheel.name), ['Group Two', 'Small', 'Medium', 'Large']);
  assert.equal(isBuiltInWheelName('  GROUP TWO '), true);
  assert.equal(isBuiltInWheelName('custom'), false);
});

test('builds the Group Two wheel from non-bot role members in display-name order', () => {
  const members = [
    { id: '3', displayName: 'Zara', user: { bot: false } },
    { id: '2', displayName: 'Helper Bot', user: { bot: true } },
    { id: '1', displayName: 'Ivy', user: { bot: false } },
  ];
  assert.deepEqual(getGroupTwoWheelMembers(members).map((member) => member.displayName), ['Ivy', 'Zara']);
});
