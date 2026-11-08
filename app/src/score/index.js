import { quantize, guessBpm } from './quantize.js';
import { detectKey } from './key.js';
import { writeMusicXml } from './musicxml.js';

/**
 * notes: [{pitch, onset, offset, velocity}] in seconds, as the server returns them.
 * Returns { xml, bpm, key, nMeasures, noteCount }.
 */
export function buildScore(notes, { bpm, grid = 4, splitPitch = 60, beats = 4, beatType = 4, title } = {}) {
  const clean = notes.filter((n) => n.offset > n.onset && n.pitch >= 21 && n.pitch <= 108);
  const tempo = bpm || guessBpm(clean);
  const key = detectKey(clean);
  const { right, left } = quantize(clean, { bpm: tempo, grid, splitPitch });
  const { xml, nMeasures, noteCount } = writeMusicXml({
    right, left, grid, bpm: tempo, fifths: key.fifths, beats, beatType, title, keyName: key.name,
  });
  return { xml, bpm: tempo, key, nMeasures, noteCount };
}

export { quantize, guessBpm, detectKey, writeMusicXml };
