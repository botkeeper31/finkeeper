import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import gifenc from 'gifenc';

const { GIFEncoder, applyPalette } = gifenc;

// A fixed palette avoids running an expensive color quantizer for every frame.
// Thirty-five moving frames retain the original 2.55-second timing while making
// the spin substantially smoother than the original 16-frame animation.
const SIZE = 420;
const CENTER = SIZE / 2;
const RADIUS = 177;
export const WHEEL_ANIMATION = Object.freeze({
  frameCount: 36,
  movingFrameDelayMs: 30,
  winnerFrameDelayMs: 1500,
});
export const COMMUNITY_PASTEL_PALETTE = [
  { name: 'Strawberry Milk', hex: '#FF9FC5' },
  { name: 'Pink Lemonade', hex: '#FFC1D6' },
  { name: 'Peach Fizz', hex: '#FFB38A' },
  { name: 'Apricot Cream', hex: '#FFD0A8' },
  { name: 'Buttercup', hex: '#FFE88A' },
  { name: 'Lemon Chiffon', hex: '#FFF2A6' },
  { name: 'Mint Macaron', hex: '#A8E6CF' },
  { name: 'Pistachio', hex: '#C7E9B0' },
  { name: 'Seafoam', hex: '#9DE2E6' },
  { name: 'Baby Blue', hex: '#A8D8FF' },
  { name: 'Periwinkle', hex: '#B9C0FF' },
  { name: 'Lavender', hex: '#CBB7FF' },
  { name: 'Lilac', hex: '#D8B4F8' },
  { name: 'Orchid', hex: '#E8B4E8' },
  { name: 'Rose Bonbon', hex: '#F7A8B8' },
  { name: 'Cotton Candy', hex: '#FFAEDB' },
];

const DEEP_PLUM = '#2E1F3E';
const POINTER_GOLD = '#F6C76B';
const WHEEL_BACKGROUND = '#30243D';
const WHEEL_CENTER = '#FF8FCB';
const WHEEL_FONT_FAMILY = 'Community Wheel';
const WHEEL_FONT_PATH = fileURLToPath(
  new URL('../node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf', import.meta.url),
);

const GIF_PALETTE = [
  ...COMMUNITY_PASTEL_PALETTE.map(({ hex }) => hexToRgb(hex)),
  hexToRgb(WHEEL_BACKGROUND),
  hexToRgb('#FFFFFF'),
  hexToRgb(POINTER_GOLD),
  hexToRgb(DEEP_PLUM),
  hexToRgb(WHEEL_CENTER),
  hexToRgb('#343434'),
  hexToRgb('#666666'),
  hexToRgb('#999999'),
  hexToRgb('#CCCCCC'),
];

if (!GlobalFonts.registerFromPath(WHEEL_FONT_PATH, WHEEL_FONT_FAMILY)) {
  throw new Error('The bundled wheel font could not be loaded.');
}

export function parseWheelEntries(raw) {
  const separator = raw.includes('\n') ? /\r?\n/ : raw.includes('|') ? /\|/ : /,/;
  const entries = raw
    .split(separator)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length < 2) throw new Error('A wheel needs at least 2 entries.');
  if (entries.length > 20) throw new Error('A wheel can contain at most 20 entries.');
  if (entries.some((entry) => entry.length > 60)) throw new Error('Each wheel entry must be 60 characters or fewer.');
  return entries;
}

export function chooseWheelResult(entries, randomIndex = randomInt) {
  return randomIndex(entries.length);
}

export function sanitizeWheelLabel(value, fallback = 'Entry') {
  const cleaned = String(value)
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\p{P}\p{Zs}\p{Sc}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || String(fallback);
}

export function renderWheelGif(entries, selectedIndex = chooseWheelResult(entries)) {
  if (!Array.isArray(entries) || entries.length < 2) throw new Error('At least two entries are required.');
  if (selectedIndex < 0 || selectedIndex >= entries.length) throw new Error('The selected index is outside the wheel.');

  const canvas = createCanvas(SIZE, SIZE);
  const context = canvas.getContext('2d');
  const encoder = GIFEncoder();
  const slice = (Math.PI * 2) / entries.length;
  const turns = 4;
  const finalRotation = (Math.PI * 2 * turns) - (Math.PI / 2) - ((selectedIndex + 0.5) * slice);

  for (let frame = 0; frame < WHEEL_ANIMATION.frameCount; frame += 1) {
    const progress = frame / (WHEEL_ANIMATION.frameCount - 1);
    const eased = 1 - ((1 - progress) ** 4);
    const rotation = finalRotation * eased;
    drawFrame(context, entries, rotation);

    const imageData = context.getImageData(0, 0, SIZE, SIZE);
    const indexed = applyPalette(imageData.data, GIF_PALETTE, 'rgb565');
    encoder.writeFrame(indexed, SIZE, SIZE, {
      palette: GIF_PALETTE,
      delay: frame === WHEEL_ANIMATION.frameCount - 1
        ? WHEEL_ANIMATION.winnerFrameDelayMs
        : WHEEL_ANIMATION.movingFrameDelayMs,
      repeat: 0,
      dispose: 1,
    });
  }

  encoder.finish();
  return {
    buffer: Buffer.from(encoder.bytesView()),
    selectedIndex,
    result: entries[selectedIndex],
  };
}

function drawFrame(context, entries, rotation) {
  context.clearRect(0, 0, SIZE, SIZE);
  context.fillStyle = WHEEL_BACKGROUND;
  context.fillRect(0, 0, SIZE, SIZE);
  context.save();
  context.translate(CENTER, CENTER);

  const slice = (Math.PI * 2) / entries.length;
  for (let index = 0; index < entries.length; index += 1) {
    const start = rotation + (index * slice);
    const end = start + slice;
    context.beginPath();
    context.moveTo(0, 0);
    context.arc(0, 0, RADIUS, start, end);
    context.closePath();
    const paletteIndex = entries.length <= COMMUNITY_PASTEL_PALETTE.length
      ? Math.floor((index * COMMUNITY_PASTEL_PALETTE.length) / entries.length)
      : index % COMMUNITY_PASTEL_PALETTE.length;
    const sectionColor = COMMUNITY_PASTEL_PALETTE[paletteIndex].hex;
    context.fillStyle = sectionColor;
    context.fill();
    context.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    context.lineWidth = 2;
    context.stroke();

    context.save();
    const sectionAngle = start + (slice / 2);
    context.rotate(sectionAngle);
    context.translate(RADIUS * 0.68, 0);
    context.fillStyle = '#FFFFFF';
    context.strokeStyle = DEEP_PLUM;
    context.lineWidth = 5;
    const shortLabels = entries.every((entry) => sanitizeWheelLabel(entry).length <= 4);
    const maximumFontSize = shortLabels
      ? Math.max(16, Math.min(28, 400 / entries.length))
      : Math.max(9, Math.min(18, 180 / entries.length));
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const maxWidth = RADIUS * 0.55;
    const cleanLabel = sanitizeWheelLabel(entries[index], `Entry ${index + 1}`);
    const label = fitLabelAtReadableSize(context, cleanLabel, maxWidth, maximumFontSize);
    context.strokeText(label, 0, 0);
    context.fillText(label, 0, 0);
    context.restore();
  }

  context.beginPath();
  context.arc(0, 0, RADIUS, 0, Math.PI * 2);
  context.strokeStyle = '#FFFFFF';
  context.lineWidth = 4;
  context.stroke();

  context.beginPath();
  context.arc(0, 0, 43, 0, Math.PI * 2);
  context.fillStyle = WHEEL_CENTER;
  context.fill();
  context.strokeStyle = '#FFFFFF';
  context.lineWidth = 4;
  context.stroke();
  context.restore();

  // The downward-facing tip is the exact landing indicator at -90 degrees.
  const wheelTop = CENTER - RADIUS;
  context.beginPath();
  context.moveTo(CENTER - 25, wheelTop - 27);
  context.lineTo(CENTER + 25, wheelTop - 27);
  context.lineTo(CENTER, wheelTop + 20);
  context.closePath();
  context.fillStyle = DEEP_PLUM;
  context.fill();
  context.strokeStyle = POINTER_GOLD;
  context.lineWidth = 7;
  context.stroke();
}

function fitLabelAtReadableSize(context, value, maxWidth, maximumFontSize) {
  let fontSize = maximumFontSize;
  context.font = `700 ${fontSize}px "${WHEEL_FONT_FAMILY}"`;
  while (fontSize > 8 && context.measureText(value).width > maxWidth) {
    fontSize -= 1;
    context.font = `700 ${fontSize}px "${WHEEL_FONT_FAMILY}"`;
  }
  return fitLabel(context, value, maxWidth);
}

function fitLabel(context, value, maxWidth) {
  const label = String(value);
  if (context.measureText(label).width <= maxWidth) return label;
  let shortened = label;
  while (shortened.length > 2 && context.measureText(`${shortened}…`).width > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened}…`;
}

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
