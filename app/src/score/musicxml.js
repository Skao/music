// Write a piano grand-staff MusicXML (score-partwise) from quantized hands.
//
// Durations are in units of 1/grid quarter. Each hand's events are laid out
// measure by measure; gaps become rests, notes crossing a barline are split and
// tied, and any duration that is not a single note value is split into tied
// standard values (largest first).

const SHARP = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const FLAT = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Note values expressible in whole `grid` units, largest first: [units, type, dots]. */
function noteValues(grid) {
  const base = [[4, 'whole'], [2, 'half'], [1, 'quarter'], [0.5, 'eighth'], [0.25, '16th'], [0.125, '32nd'], [0.0625, '64th']];
  const out = [];
  for (const [q, type] of base) {
    const u = q * grid;
    if (Number.isInteger(u * 1.5) && u * 1.5 >= 1 && u >= 1) out.push([u * 1.5, type, 1]);
    if (Number.isInteger(u) && u >= 1) out.push([u, type, 0]);
  }
  return out.sort((a, b) => b[0] - a[0]);
}

function decompose(units, values) {
  const parts = [];
  let left = units;
  while (left > 0) {
    const v = values.find(([u]) => u <= left);
    if (!v) break;
    parts.push(v);
    left -= v[0];
  }
  return parts;
}

function pitchXml(midi, fifths) {
  const [step, alter] = (fifths < 0 ? FLAT : SHARP)[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>`;
}

function dotsXml(dots) {
  return dots ? '<dot/>'.repeat(dots) : '';
}

function noteXml({ pitches, units, type, dots, tieStart, tieStop, staff, voice, fifths }) {
  let xml = '';
  pitches.forEach((p, i) => {
    const ties = (tieStart ? '<tie type="start"/>' : '') + (tieStop ? '<tie type="stop"/>' : '');
    const tied = (tieStop ? '<tied type="stop"/>' : '') + (tieStart ? '<tied type="start"/>' : '');
    xml += `<note>${i ? '<chord/>' : ''}${pitchXml(p, fifths)}<duration>${units}</duration>${ties}`
      + `<voice>${voice}</voice><type>${type}</type>${dotsXml(dots)}<staff>${staff}</staff>`
      + (tied ? `<notations>${tied}</notations>` : '') + '</note>';
  });
  return xml;
}

function restXml({ units, type, dots, staff, voice, whole }) {
  if (whole) return `<note><rest measure="yes"/><duration>${units}</duration><voice>${voice}</voice><staff>${staff}</staff></note>`;
  return `<note><rest/><duration>${units}</duration><voice>${voice}</voice><type>${type}</type>${dotsXml(dots)}<staff>${staff}</staff></note>`;
}

/** Lay one hand's events out as per-measure XML strings. */
function layoutHand(events, { grid, unitsPerMeasure, nMeasures, staff, voice, fifths }) {
  const values = noteValues(grid);
  const measures = Array.from({ length: nMeasures }, () => '');
  let noteCount = 0;
  let cursor = 0; // absolute units

  const emitRest = (from, to) => {
    let at = from;
    while (at < to) {
      const m = Math.floor(at / unitsPerMeasure);
      const mEnd = (m + 1) * unitsPerMeasure;
      const seg = Math.min(to, mEnd) - at;
      if (seg === unitsPerMeasure) {
        measures[m] += restXml({ units: seg, staff, voice, whole: true });
      } else {
        for (const [u, type, dots] of decompose(seg, values)) measures[m] += restXml({ units: u, type, dots, staff, voice });
      }
      at += seg;
    }
  };

  for (const ev of events) {
    if (ev.on > cursor) emitRest(cursor, ev.on);
    let at = ev.on;
    const end = ev.on + ev.dur;
    let first = true;
    while (at < end) {
      const m = Math.floor(at / unitsPerMeasure);
      const mEnd = (m + 1) * unitsPerMeasure;
      const seg = Math.min(end, mEnd) - at;
      const pieces = decompose(seg, values);
      if (!pieces.length) break;
      for (const [u, type, dots] of pieces) {
        const isLast = at + u >= end;
        measures[m] += noteXml({ pitches: ev.pitches, units: u, type, dots, tieStart: !isLast, tieStop: !first, staff, voice, fifths });
        noteCount += ev.pitches.length;
        first = false;
        at += u;
      }
    }
    cursor = end;
  }
  emitRest(cursor, nMeasures * unitsPerMeasure);
  return { measures, noteCount };
}

export function writeMusicXml({ right, left, grid = 4, bpm = 120, fifths = 0, beats = 4, beatType = 4, title = 'Transcription', keyName = '' }) {
  const unitsPerMeasure = beats * grid * (4 / beatType);
  const lastUnit = Math.max(0, ...right.map((e) => e.on + e.dur), ...left.map((e) => e.on + e.dur));
  const nMeasures = Math.max(1, Math.ceil(lastUnit / unitsPerMeasure));

  const rh = layoutHand(right, { grid, unitsPerMeasure, nMeasures, staff: 1, voice: 1, fifths });
  const lh = layoutHand(left, { grid, unitsPerMeasure, nMeasures, staff: 2, voice: 2, fifths });

  let body = '';
  for (let m = 0; m < nMeasures; m++) {
    body += `<measure number="${m + 1}">`;
    if (m === 0) {
      body += `<attributes><divisions>${grid}</divisions><key><fifths>${fifths}</fifths></key>`
        + `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time><staves>2</staves>`
        + '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>'
        + `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(bpm)}</per-minute></metronome></direction-type><sound tempo="${Math.round(bpm)}"/></direction>`;
    }
    body += rh.measures[m] + `<backup><duration>${unitsPerMeasure}</duration></backup>` + lh.measures[m];
    if (m === nMeasures - 1) body += '<barline location="right"><bar-style>light-heavy</bar-style></barline>';
    body += '</measure>\n';
  }

  const keyField = keyName
    ? `<miscellaneous><miscellaneous-field name="key">${esc(keyName)}</miscellaneous-field></miscellaneous>`
    : '';
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n'
    + '<score-partwise version="4.0">\n'
    + `<work><work-title>${esc(title)}</work-title></work>\n`
    + `<identification><encoding><software>Pianoscribe</software></encoding>${keyField}</identification>\n`
    + '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>\n'
    + `<part id="P1">\n${body}</part>\n`
    + '</score-partwise>\n';
  return { xml, nMeasures, noteCount: rh.noteCount + lh.noteCount };
}
