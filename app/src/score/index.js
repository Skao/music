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
  const { right, left, t0 } = quantize(clean, { bpm: tempo, grid, splitPitch });
  const { xml, nMeasures, noteCount } = writeMusicXml({
    right, left, grid, bpm: tempo, fifths: key.fifths, beats, beatType, title, keyName: key.name,
  });
  return {
    xml, bpm: tempo, key, nMeasures, noteCount,
    // For the player: what the score says, and what the model heard, both in seconds from the first note.
    written: writtenEvents(right, left, tempo, grid),
    raw: clean.map((n) => ({ t: n.onset - t0, dur: n.offset - n.onset, pitch: n.pitch, velocity: n.velocity || 80 })),
  };
}

/** The quantized grid events as {t, dur, pitch, velocity} in seconds at the score's tempo. */
export function writtenEvents(right, left, bpm, grid) {
  const secPerUnit = 60 / bpm / grid;
  const out = [];
  for (const ev of [...right, ...left]) {
    for (const pitch of ev.pitches) out.push({ t: ev.on * secPerUnit, dur: ev.dur * secPerUnit, pitch, velocity: ev.velocity || 80 });
  }
  return out.sort((a, b) => a.t - b.t);
}

export { quantize, guessBpm, detectKey, writeMusicXml };
