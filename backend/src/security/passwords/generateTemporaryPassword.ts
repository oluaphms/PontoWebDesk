import { randomInt } from 'node:crypto';

const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SPECIAL = '!@#$%^&*()-_=+[]{}';
const ALL = `${LOWER}${UPPER}${DIGITS}${SPECIAL}`;

function pick(chars: string): string {
  return chars[randomInt(0, chars.length)];
}

export function generateTemporaryPassword(length = 20): string {
  const size = Math.max(16, length);
  const chars = [
    pick(LOWER),
    pick(UPPER),
    pick(DIGITS),
    pick(SPECIAL),
  ];
  while (chars.length < size) {
    chars.push(pick(ALL));
  }

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
