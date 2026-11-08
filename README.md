# Pianoscribe

Hold a phone near a speaker playing piano music, record, and read the result
as sheet music. Personal use.

Two parts:

| Part | Where | Job |
| --- | --- | --- |
| `server/` | a Linux box with Python | runs the piano transcription model on the uploaded recording and returns raw note events (pitch, onset, offset, velocity) plus a tempo estimate and a MIDI file |
| `app/` | the phone (Expo / React Native) | records, uploads, and **builds the score itself**: tempo grid, hand split, key detection, MusicXML, drawn with OpenSheetMusicDisplay in a WebView; exports MusicXML / MIDI / the raw notes |

The split is deliberate. The model is the only heavy part and it is the only
thing the server does. Everything musical happens in `app/src/score/`, which is
plain JavaScript with no native dependencies, so it is unit-tested with Node on
the desktop and runs unchanged on the phone.

## Status (2026-11-07)

- Score library (`app/src/score/`): written and tested under Node (`node --test
  scripts/score.test.mjs`, 9 passing). The sample page it emits renders as a
  grand staff in OpenSheetMusicDisplay 1.9.0 (checked in Chrome).
- Server: deployed on the roads box and verified end to end with a synthetic
  clip (see Deploy). Waiting on the `music.catchweir.com` A record.
- App: written, compiles under the Expo Babel preset, **never run on a device**.
- Not built: on-device model, pedal marks, inner voices, triplets, time
  signatures other than 4/4, Android `UNPROCESSED` confirmation on a real phone.

## Server

```bash
sudo apt install ffmpeg python3-venv
python3 -m venv venv && . venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r server/requirements.txt
export PIANOSCRIBE_TOKEN=some-secret
uvicorn --app-dir server pianoscribe_server:app --host 0.0.0.0 --port 8765
```

First request downloads the ByteDance checkpoint (~165 MB) into the user's
cache. Inference needs roughly 1.5 GB of RAM on CPU and runs at a few times
real time; a 1 GB VPS will swap or die. Set `PIANOSCRIBE_MODEL=basicpitch` and
`pip install basic-pitch` for the lighter Spotify model, which is less accurate
on piano.

Endpoints: `GET /health`, `POST /transcribe` (multipart `file`, `Authorization:
Bearer <token>`). Response:

```json
{ "model": "bytedance", "duration": 42.1, "bpm": 96.0, "seconds": 11.3,
  "notes": [ { "pitch": 64, "onset": 0.51, "offset": 0.98, "velocity": 71 } ],
  "pedal": [ { "onset": 0.4, "offset": 2.1 } ],
  "midi_base64": "TVRoZC..." }
```

`python server/cli.py recording.m4a` prints the same JSON for a local file.

### Deploy to music.catchweir.com

Same pattern as the Spa Racer road server. `server/deploy/` holds `push.sh`
(PC → box), `setup.sh` (one-time, on the box), the `Caddyfile` block and the
systemd unit.

1. Point an `A` record for `music.catchweir.com` at the box.
2. From the repo root on the PC: `bash server/deploy/push.sh root@music.catchweir.com`
3. On the box: `bash /opt/pianoscribe/server/deploy/setup.sh music.catchweir.com`.
   It prints the token the app needs.
4. In the app: server `https://music.catchweir.com`, token as printed.

Later code changes: run `push.sh` again. The Caddy block is appended, not
written over, so the music host can share the roads box.

**Deployed 2026-11-07 on the roads box** (149.28.234.199, 1 vCPU, 1 GB + 2.3 GB
swap). Measured there with a 3.5 s synthetic clip: first request after idle
about 90 s (model load through swap), warm requests about 22 s, roughly 2 s of
compute per second of audio plus overhead. The model is dropped after 5 idle
minutes (`PIANOSCRIBE_IDLE_UNLOAD`) so the road server gets its memory back. A
2 vCPU / 2 GB box would be several times faster; move there if the wait grates.

## App

```bash
cd app
npm install
npx expo start          # Expo Go for a first look (recording + WebView both work there)
npx expo run:android    # dev build; needed for the expo-build-properties cleartext setting
```

On the home screen set the server URL and token. Record, stop, wait, read.
The score screen has:

- **Tempo** ±1, ½, ×2: the grid is rebuilt from the raw notes each time, so a
  wrong tempo estimate is one tap away from fixed. Tempo estimators often land
  an octave off.
- **Split**: the pitch at which notes go to the treble staff (default middle C).
- **Grid**: finest value, quarter to 32nd.
- **Zoom**.
- **MusicXML / MIDI / Notes JSON** share sheets. The JSON is what the server
  returned; `node scripts/render-sample.mjs notes.json out/` on the desktop
  rebuilds the score from it, which is how to reproduce a bad score without the
  phone.

### Recording path

Mono 48 kHz AAC through `expo-audio`. On Android the recorder asks for the
`unprocessed` audio source (falling back to `voice_recognition`, then `mic`)
so the system does not run speech-tuned gain control and noise suppression over
sustained piano tones. A level meter turns red above -2 dBFS: a phone a few
centimetres from a speaker clips easily, turn the speaker down rather than
moving the phone away.

## Score library

`app/src/score/`:

- `quantize.js`: tempo grid (units of 1/grid quarter), hand split by pitch,
  chord grouping by onset, overlapping notes cut at the next onset in the same
  hand (v1: no inner voices), onset-histogram BPM fallback.
- `key.js`: Krumhansl-Schmuckler profile correlation with a penalty for time
  spent outside the candidate scale, which stops the usual drift to the
  relative minor.
- `musicxml.js`: grand-staff `score-partwise`, measures, rests filling gaps,
  barline ties, odd lengths split into tied standard values, sharps or flats
  by key.
- `index.js`: `buildScore(notes, { bpm, grid, splitPitch })`.

`scripts/render-sample.mjs` writes `sample.musicxml` and a `sample.html` that
renders it with the same OpenSheetMusicDisplay page the app's WebView uses.

## Next

1. Deploy to music.catchweir.com (above) and fix whatever the first start finds.
2. Run the app on the S22, confirm `unprocessed` is accepted, record a real
   piece, and look at the score.
3. Then the musical improvements, in the order they hurt: triplets, pedal
   marks, a smarter hand split, inner voices.
