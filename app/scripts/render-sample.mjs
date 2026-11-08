// Build a sample score from synthetic notes (or a server notes.json) and write
// MusicXML plus a standalone HTML page that renders it with OpenSheetMusicDisplay,
// the same renderer the phone uses.
//
//   node scripts/render-sample.mjs [notes.json] [out-dir]
import fs from 'node:fs';
import path from 'node:path';
import { buildScore } from '../src/score/index.js';
import { OSMD_HTML } from '../src/scoreHtml.js';

const [, , input, outDir = '.'] = process.argv;

let notes;
let bpm;
if (input) {
  const data = JSON.parse(fs.readFileSync(input, 'utf8'));
  notes = data.notes || data;
  bpm = data.bpm || undefined;
} else {
  // First phrase of a familiar tune, 100 bpm, with a simple left hand.
  bpm = 100;
  const q = 60 / bpm;
  const n = (pitch, beat, beats, velocity = 80) => ({ pitch, onset: beat * q + 0.02 * Math.random(), offset: (beat + beats) * q - 0.03, velocity });
  const melody = [[64, 0, 1], [64, 1, 1], [65, 2, 1], [67, 3, 1], [67, 4, 1], [65, 5, 1], [64, 6, 1], [62, 7, 1],
    [60, 8, 1], [60, 9, 1], [62, 10, 1], [64, 11, 1], [64, 12, 1.5], [62, 13.5, 0.5], [62, 14, 2]];
  const bass = [[48, 0, 2], [55, 2, 2], [48, 4, 2], [55, 6, 2], [48, 8, 2], [55, 10, 2], [48, 12, 2], [43, 14, 2]];
  const chords = [[52, 0, 2], [59, 2, 2], [52, 4, 2], [59, 6, 2], [52, 8, 2], [59, 10, 2], [52, 12, 2], [50, 14, 2]];
  notes = [...melody, ...bass, ...chords].map((a) => n(...a));
}

const score = buildScore(notes, { bpm, title: input ? path.basename(input) : 'Sample' });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'sample.musicxml'), score.xml);
fs.writeFileSync(path.join(outDir, 'sample.html'), OSMD_HTML.replace('</body>', `<script>window.setScore(${JSON.stringify(score.xml)});</script></body>`));
console.log(`${score.nMeasures} measures, ${score.noteCount} notes, ${score.key.name}, ${score.bpm} bpm -> ${path.resolve(outDir, 'sample.html')}`);
