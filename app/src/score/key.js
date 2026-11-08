// Krumhansl-Schmuckler key finding on a duration-weighted pitch-class profile.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10, 11];
const PENALTY = 3.0;

function corr(a, b) {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Circle-of-fifths position (-6..6) of the major key whose tonic is pitch class pc. */
function fifthsOfMajor(pc) {
  let f = (pc * 7) % 12;
  if (f > 6) f -= 12;
  return f;
}

export function detectKey(notes) {
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[n.pitch % 12] += Math.max(0.05, n.offset - n.onset);
  if (!hist.some((x) => x > 0)) return { tonic: 0, mode: 'major', fifths: 0, name: 'C major' };
  // Profile correlation, minus a penalty for time spent outside the key's
  // scale (harmonic minor's raised seventh counts as inside). The penalty
  // breaks the profile's known bias toward the relative minor.
  const total = hist.reduce((s, x) => s + x, 0);
  const outside = (scale) => hist.reduce((s, x, i) => (scale.includes(i) ? s : s + x), 0) / total;
  let best = { score: -Infinity };
  for (let pc = 0; pc < 12; pc++) {
    const rot = hist.map((_, i) => hist[(i + pc) % 12]);
    const majScale = MAJOR_SCALE.map((d) => (d + pc) % 12);
    const minScale = MINOR_SCALE.map((d) => (d + pc) % 12);
    const sMaj = corr(rot, MAJOR) - PENALTY * outside(majScale);
    const sMin = corr(rot, MINOR) - PENALTY * outside(minScale);
    if (sMaj > best.score) best = { score: sMaj, tonic: pc, mode: 'major' };
    if (sMin > best.score) best = { score: sMin, tonic: pc, mode: 'minor' };
  }
  const fifths = best.mode === 'major' ? fifthsOfMajor(best.tonic) : fifthsOfMajor((best.tonic + 3) % 12);
  const names = fifths < 0 ? NAMES_FLAT : NAMES_SHARP;
  return { tonic: best.tonic, mode: best.mode, fifths, name: `${names[best.tonic]} ${best.mode}` };
}
