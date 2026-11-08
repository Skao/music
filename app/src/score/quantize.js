// Turn raw note events (seconds) into grid-aligned events (integer units).
//
// One unit = 1/grid of a quarter note. With grid = 4 the finest value is a
// sixteenth. Notes inside one hand never overlap after this step: a note is
// cut at the next onset in the same hand, and notes sharing an onset become
// one chord. That is a deliberate v1 simplification (no inner voices).

export function quantize(notes, { bpm, grid = 4, splitPitch = 60, minDurUnits = 1 } = {}) {
  if (!notes.length) return { right: [], left: [], t0: 0 };
  const secPerUnit = 60 / bpm / grid;
  const t0 = Math.min(...notes.map((n) => n.onset));

  const hands = { right: new Map(), left: new Map() };
  for (const n of notes) {
    const on = Math.round((n.onset - t0) / secPerUnit);
    const dur = Math.max(minDurUnits, Math.round((n.offset - n.onset) / secPerUnit));
    const hand = n.pitch >= splitPitch ? hands.right : hands.left;
    const g = hand.get(on) || { on, pitches: new Set(), dur: 0, velocity: 0 };
    g.pitches.add(n.pitch);
    g.dur = Math.max(g.dur, dur);
    g.velocity = Math.max(g.velocity, n.velocity || 0);
    hand.set(on, g);
  }

  const finish = (m) => {
    const evs = [...m.values()].sort((a, b) => a.on - b.on);
    for (let i = 0; i < evs.length; i++) {
      const next = evs[i + 1];
      if (next) evs[i].dur = Math.min(evs[i].dur, next.on - evs[i].on);
      evs[i].pitches = [...evs[i].pitches].sort((a, b) => a - b);
    }
    return evs.filter((e) => e.dur > 0);
  };
  return { right: finish(hands.right), left: finish(hands.left), t0 };
}

/** Rough BPM from note onsets when the server gave none: the inter-onset
 *  interval histogram peak, folded into 60..180. */
export function guessBpm(notes) {
  const ons = [...new Set(notes.map((n) => Math.round(n.onset * 100) / 100))].sort((a, b) => a - b);
  if (ons.length < 4) return 120;
  const bins = new Map();
  for (let i = 1; i < ons.length; i++) {
    const d = ons[i] - ons[i - 1];
    if (d < 0.08 || d > 2) continue;
    const k = Math.round(d * 50) / 50; // 20 ms bins
    bins.set(k, (bins.get(k) || 0) + 1);
  }
  if (!bins.size) return 120;
  const [ioi] = [...bins.entries()].sort((a, b) => b[1] - a[1])[0];
  let bpm = 60 / ioi;
  while (bpm > 180) bpm /= 2;
  while (bpm < 60) bpm *= 2;
  return Math.round(bpm);
}
