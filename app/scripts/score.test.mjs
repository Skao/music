// node --test scripts/
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScore, quantize, detectKey } from '../src/score/index.js';

const BPM = 120; // quarter = 0.5 s
const q = (beat) => beat * 0.5;
const note = (pitch, beat, beats, velocity = 80) => ({ pitch, onset: q(beat), offset: q(beat + beats), velocity });

function count(xml, re) {
  return (xml.match(re) || []).length;
}

function assertBalanced(xml) {
  const opens = count(xml, /<([a-z-]+)(\s[^>]*)?(?<!\/)>/g);
  const closes = count(xml, /<\/[a-z-]+>/g);
  assert.equal(opens, closes, 'every opening tag has a closing tag');
}

test('C major scale over a held bass note', () => {
  const notes = [];
  [60, 62, 64, 65, 67, 69, 71, 72].forEach((p, i) => notes.push(note(p, i, 1)));
  notes.push(note(48, 0, 4));
  notes.push(note(48, 4, 4));
  const s = buildScore(notes, { bpm: BPM });
  assertBalanced(s.xml);
  assert.equal(s.nMeasures, 2);
  assert.equal(s.key.fifths, 0);
  assert.equal(s.noteCount, 10);
  assert.equal(count(s.xml, /<type>quarter<\/type>/g), 8);
  assert.equal(count(s.xml, /<type>whole<\/type>/g), 2);
  assert.equal(count(s.xml, /<rest/g), 0, 'no rests when both hands are full');
  assert.equal(count(s.xml, /<staff>2<\/staff>/g), 2);
});

test('a note across the barline is split and tied', () => {
  const notes = [note(67, 2, 4), note(40, 0, 1)];
  const s = buildScore(notes, { bpm: BPM });
  assertBalanced(s.xml);
  assert.equal(s.nMeasures, 2);
  assert.equal(count(s.xml, /<tie type="start"\/>/g), 1);
  assert.equal(count(s.xml, /<tie type="stop"\/>/g), 1);
  assert.equal(count(s.xml, /<tied type="start"\/>/g), 1);
  // right hand: half rest, half note (tie) | half note, half rest
  assert.equal(count(s.xml, /<rest\/><duration>8<\/duration><voice>1<\/voice><type>half<\/type>/g), 2);
});

test('gaps become rests and the last measure is padded', () => {
  const notes = [note(72, 0, 1), note(72, 3, 1), note(36, 0, 1)];
  const s = buildScore(notes, { bpm: BPM });
  assertBalanced(s.xml);
  assert.equal(s.nMeasures, 1);
  // RH: q, half rest, q ; LH: q, dotted-half rest
  assert.equal(count(s.xml, /<rest\/><duration>8<\/duration><voice>1<\/voice><type>half<\/type>/g), 1);
  assert.equal(count(s.xml, /<rest\/><duration>12<\/duration><voice>2<\/voice><type>half<\/type><dot\/>/g), 1);
});

test('odd lengths split into tied standard values', () => {
  const notes = [note(64, 0, 1.25), note(36, 0, 4)]; // five sixteenths
  const s = buildScore(notes, { bpm: BPM });
  assertBalanced(s.xml);
  assert.match(s.xml, /<type>quarter<\/type>.*?<\/note><note>.*?<type>16th<\/type>/s);
  assert.equal(count(s.xml, /<tie type="start"\/>/g), 1);
});

test('simultaneous notes become one chord', () => {
  const notes = [note(60, 0, 2), note(64, 0, 2), note(67, 0.02, 2), note(36, 0, 2)];
  const s = buildScore(notes, { bpm: BPM });
  assert.equal(count(s.xml, /<chord\/>/g), 2);
  assert.equal(s.noteCount, 4);
});

test('overlapping notes in one hand are cut at the next onset', () => {
  const { right } = quantize([note(60, 0, 4), note(62, 1, 1)], { bpm: BPM });
  assert.deepEqual(right.map((e) => [e.on, e.dur]), [[0, 4], [4, 4]]);
});

test('G major is spelled with F sharp and one sharp in the key', () => {
  const notes = [];
  [67, 69, 71, 72, 74, 76, 78, 79, 78, 76, 74, 72, 71, 69, 67].forEach((p, i) => notes.push(note(p, i, 1)));
  notes.push(note(43, 0, 4), note(50, 4, 4), note(43, 8, 4), note(43, 12, 4));
  const k = detectKey(notes);
  assert.equal(k.name, 'G major');
  const s = buildScore(notes, { bpm: BPM });
  assert.match(s.xml, /<fifths>1<\/fifths>/);
  assert.match(s.xml, /<step>F<\/step><alter>1<\/alter>/);
});

test('F major is spelled with B flat', () => {
  const notes = [];
  [65, 67, 69, 70, 72, 74, 76, 77, 76, 74, 72, 70, 69, 67, 65].forEach((p, i) => notes.push(note(p, i, 1)));
  notes.push(note(41, 0, 4), note(48, 4, 4), note(41, 8, 4), note(41, 12, 4));
  const s = buildScore(notes, { bpm: BPM });
  assert.equal(s.key.name, 'F major');
  assert.match(s.xml, /<fifths>-1<\/fifths>/);
  assert.match(s.xml, /<step>B<\/step><alter>-1<\/alter>/);
});

test('empty input still yields one measure of rests', () => {
  const s = buildScore([], { bpm: BPM });
  assertBalanced(s.xml);
  assert.equal(s.nMeasures, 1);
  assert.equal(count(s.xml, /<rest measure="yes"\/>/g), 2);
});
