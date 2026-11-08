import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState,
} from 'expo-audio';
import { WebView } from 'react-native-webview';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildScore } from './src/score/index.js';
import { OSMD_HTML } from './src/scoreHtml.js';

const SETTINGS_KEY = 'pianoscribe.settings';
const LAST_KEY = 'pianoscribe.last';
const DEFAULTS = { serverUrl: 'https://music.catchweir.com', token: '', splitPitch: 60, grid: 4 };

// Mono, 48 kHz, and on Android the UNPROCESSED source so the OS does not run
// its speech-tuned gain control and noise suppression over the piano. Devices
// that lack UNPROCESSED fall back through the list in startRecording().
const ANDROID_SOURCES = ['unprocessed', 'voice_recognition', 'mic'];
function recordingOptions(audioSource) {
  return {
    ...RecordingPresets.HIGH_QUALITY,
    numberOfChannels: 1,
    sampleRate: 48000,
    bitRate: 192000,
    isMeteringEnabled: true,
    android: { ...RecordingPresets.HIGH_QUALITY.android, audioSource },
  };
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (midi) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

function b64ToBytes(b64) {
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function shareFile(name, content, mimeType) {
  const file = new File(Paths.cache, name);
  try {
    if (file.exists) file.delete();
  } catch {}
  await file.write(content);
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
}

export default function App() {
  const [settings, setSettings] = useState(DEFAULTS);
  const [phase, setPhase] = useState('idle'); // idle | recording | busy | score
  const [status, setStatus] = useState('');
  const [result, setResult] = useState(null); // { notes, bpm, midi_base64, duration, model }
  const [hasLast, setHasLast] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const s = await AsyncStorage.getItem(SETTINGS_KEY);
        if (s) setSettings({ ...DEFAULTS, ...JSON.parse(s) });
        setHasLast(!!(await AsyncStorage.getItem(LAST_KEY)));
      } catch {}
    })();
  }, []);

  const updateSettings = (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next)).catch(() => {});
  };

  const openLast = async () => {
    const s = await AsyncStorage.getItem(LAST_KEY);
    if (s) {
      setResult(JSON.parse(s));
      setPhase('score');
    }
  };

  const onResult = (data) => {
    setResult(data);
    setHasLast(true);
    AsyncStorage.setItem(LAST_KEY, JSON.stringify(data)).catch(() => {});
    setPhase('score');
  };

  if (phase === 'score' && result) {
    return (
      <ScoreScreen
        result={result}
        settings={settings}
        updateSettings={updateSettings}
        onBack={() => setPhase('idle')}
      />
    );
  }

  return (
    <RecordScreen
      settings={settings}
      updateSettings={updateSettings}
      phase={phase}
      setPhase={setPhase}
      status={status}
      setStatus={setStatus}
      onResult={onResult}
      hasLast={hasLast}
      openLast={openLast}
    />
  );
}

// ------------------------------------------------------------------ record

function RecordScreen({ settings, updateSettings, phase, setPhase, status, setStatus, onResult, hasLast, openLast }) {
  const recorder = useAudioRecorder(recordingOptions(ANDROID_SOURCES[0]));
  const state = useAudioRecorderState(recorder, 100);

  const startRecording = async () => {
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Microphone', 'Pianoscribe needs the microphone to listen.');
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    let prepared = false;
    for (const src of ANDROID_SOURCES) {
      try {
        await recorder.prepareToRecordAsync(recordingOptions(src));
        prepared = true;
        break;
      } catch (e) {
        setStatus(`Audio source ${src} unavailable, trying the next…`);
      }
    }
    if (!prepared) {
      Alert.alert('Recording', 'Could not start the recorder.');
      return;
    }
    recorder.record();
    setStatus('');
    setPhase('recording');
  };

  const stopAndTranscribe = async () => {
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) {
      setPhase('idle');
      return;
    }
    setPhase('busy');
    setStatus('Uploading…');
    try {
      const form = new FormData();
      form.append('file', { uri, name: 'recording.m4a', type: 'audio/mp4' });
      const headers = settings.token ? { Authorization: `Bearer ${settings.token}` } : {};
      setStatus('Transcribing on the server…');
      const res = await fetch(`${settings.serverUrl.replace(/\/$/, '')}/transcribe`, { method: 'POST', headers, body: form });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const data = await res.json();
      if (!data.notes || !data.notes.length) {
        Alert.alert('No notes', 'The model heard no piano notes. Try closer to the speaker or a little louder.');
        setPhase('idle');
        return;
      }
      onResult({ ...data, recordedAt: new Date().toISOString() });
    } catch (e) {
      Alert.alert('Transcription failed', String(e.message || e));
      setPhase('idle');
    } finally {
      setStatus('');
    }
  };

  const metering = state.metering ?? -60; // dBFS
  const level = Math.max(0, Math.min(1, (metering + 60) / 60));
  const tooLoud = metering > -2;
  const seconds = Math.floor((state.durationMillis || 0) / 1000);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Pianoscribe</Text>
        <Text style={styles.subtitle}>Hold the phone near the speaker. Record, stop, read.</Text>

        <View style={styles.recordBlock}>
          {phase === 'busy' ? (
            <>
              <ActivityIndicator size="large" />
              <Text style={styles.status}>{status}</Text>
            </>
          ) : phase === 'recording' ? (
            <>
              <View style={styles.meterTrack}>
                <View style={[styles.meterFill, { width: `${Math.round(level * 100)}%`, backgroundColor: tooLoud ? '#d33' : '#2a7' }]} />
              </View>
              <Text style={[styles.status, tooLoud && styles.warn]}>
                {tooLoud ? 'Too loud: turn the speaker down' : `${metering.toFixed(0)} dB`} · {seconds}s
              </Text>
              <Pressable style={[styles.bigButton, styles.stop]} onPress={stopAndTranscribe}>
                <Text style={styles.bigButtonText}>Stop and transcribe</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable style={styles.bigButton} onPress={startRecording}>
                <Text style={styles.bigButtonText}>Record</Text>
              </Pressable>
              {hasLast && (
                <Pressable style={styles.linkButton} onPress={openLast}>
                  <Text style={styles.link}>Open the last score</Text>
                </Pressable>
              )}
              {!!status && <Text style={styles.status}>{status}</Text>}
            </>
          )}
        </View>

        <Text style={styles.section}>Server</Text>
        <TextInput
          style={styles.input}
          value={settings.serverUrl}
          onChangeText={(v) => updateSettings({ serverUrl: v.trim() })}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="http://host:8765"
        />
        <TextInput
          style={styles.input}
          value={settings.token}
          onChangeText={(v) => updateSettings({ token: v.trim() })}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="token (PIANOSCRIBE_TOKEN on the server)"
        />
        <Text style={styles.hint}>
          Recording: mono 48 kHz AAC, Android audio source "unprocessed" when the device has it, so the OS leaves the
          piano alone. Notes come back from the server; the score itself is built on this phone.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ------------------------------------------------------------------- score

function ScoreScreen({ result, settings, updateSettings, onBack }) {
  const webRef = useRef(null);
  const [webReady, setWebReady] = useState(false);
  const [bpm, setBpm] = useState(result.bpm || 0);
  const [zoom, setZoom] = useState(0.6);
  const [rendered, setRendered] = useState(false);

  const score = useMemo(
    () => buildScore(result.notes, {
      bpm: bpm || undefined,
      grid: settings.grid,
      splitPitch: settings.splitPitch,
      title: `Transcription ${result.recordedAt ? result.recordedAt.slice(0, 16).replace('T', ' ') : ''}`.trim(),
    }),
    [result, bpm, settings.grid, settings.splitPitch],
  );

  const send = useCallback((msg) => {
    webRef.current?.postMessage(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    if (webReady) {
      setRendered(false);
      send({ type: 'score', xml: score.xml });
    }
  }, [webReady, score, send]);

  useEffect(() => {
    if (webReady) send({ type: 'zoom', zoom });
  }, [webReady, zoom, send]);

  const onMessage = (ev) => {
    try {
      const msg = JSON.parse(ev.nativeEvent.data);
      if (msg.type === 'ready') setWebReady(true);
      if (msg.type === 'rendered') setRendered(true);
      if (msg.type === 'error') Alert.alert('Render error', msg.message);
    } catch {}
  };

  const stamp = (result.recordedAt || new Date().toISOString()).slice(0, 19).replace(/[:T]/g, '-');
  const exportXml = () => shareFile(`pianoscribe-${stamp}.musicxml`, score.xml, 'application/vnd.recordare.musicxml+xml').catch((e) => Alert.alert('Export', String(e)));
  const exportMidi = () => {
    if (!result.midi_base64) return Alert.alert('Export', 'The server sent no MIDI for this take.');
    shareFile(`pianoscribe-${stamp}.mid`, b64ToBytes(result.midi_base64), 'audio/midi').catch((e) => Alert.alert('Export', String(e)));
  };
  const exportNotes = () => {
    const { midi_base64, ...rest } = result;
    shareFile(`pianoscribe-${stamp}.json`, JSON.stringify(rest), 'application/json').catch((e) => Alert.alert('Export', String(e)));
  };

  const effectiveBpm = Math.round(score.bpm);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.toolbar}>
        <Pressable onPress={onBack} style={styles.toolButton}><Text style={styles.toolText}>‹ Back</Text></Pressable>
        <Text style={styles.toolInfo} numberOfLines={1}>
          {score.key.name} · {score.nMeasures} bars · {result.notes.length} notes{rendered ? '' : ' · drawing…'}
        </Text>
      </View>

      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html: OSMD_HTML, baseUrl: 'https://localhost/' }}
        onMessage={onMessage}
        style={styles.web}
        javaScriptEnabled
        domStorageEnabled
        setBuiltInZoomControls={false}
        scalesPageToFit={false}
      />

      <View style={styles.controls}>
        <Stepper
          label="Tempo"
          value={`${effectiveBpm}`}
          onMinus={() => setBpm(effectiveBpm - 1)}
          onPlus={() => setBpm(effectiveBpm + 1)}
          extra={[
            { label: '½', onPress: () => setBpm(Math.round(effectiveBpm / 2)) },
            { label: '×2', onPress: () => setBpm(effectiveBpm * 2) },
          ]}
        />
        <Stepper
          label="Split"
          value={noteName(settings.splitPitch)}
          onMinus={() => updateSettings({ splitPitch: Math.max(36, settings.splitPitch - 1) })}
          onPlus={() => updateSettings({ splitPitch: Math.min(84, settings.splitPitch + 1) })}
        />
        <Stepper
          label="Grid"
          value={{ 1: '♩', 2: '♪', 4: '16th', 8: '32nd' }[settings.grid] || `${settings.grid}`}
          onMinus={() => updateSettings({ grid: Math.max(1, settings.grid / 2) })}
          onPlus={() => updateSettings({ grid: Math.min(8, settings.grid * 2) })}
        />
        <Stepper
          label="Zoom"
          value={`${Math.round(zoom * 100)}%`}
          onMinus={() => setZoom(Math.max(0.3, +(zoom - 0.1).toFixed(2)))}
          onPlus={() => setZoom(Math.min(2, +(zoom + 0.1).toFixed(2)))}
        />
      </View>
      <View style={styles.exports}>
        <Pressable style={styles.exportButton} onPress={exportXml}><Text style={styles.exportText}>MusicXML</Text></Pressable>
        <Pressable style={styles.exportButton} onPress={exportMidi}><Text style={styles.exportText}>MIDI</Text></Pressable>
        <Pressable style={styles.exportButton} onPress={exportNotes}><Text style={styles.exportText}>Notes JSON</Text></Pressable>
      </View>
    </SafeAreaView>
  );
}

function Stepper({ label, value, onMinus, onPlus, extra = [] }) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <Pressable style={styles.stepButton} onPress={onMinus}><Text style={styles.stepText}>−</Text></Pressable>
      <Text style={styles.stepValue}>{value}</Text>
      <Pressable style={styles.stepButton} onPress={onPlus}><Text style={styles.stepText}>+</Text></Pressable>
      {extra.map((x) => (
        <Pressable key={x.label} style={styles.stepButton} onPress={x.onPress}><Text style={styles.stepText}>{x.label}</Text></Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { padding: 20, gap: 10 },
  title: { fontSize: 28, fontWeight: '700', marginTop: 12 },
  subtitle: { fontSize: 15, color: '#555' },
  recordBlock: { alignItems: 'center', paddingVertical: 28, gap: 14 },
  bigButton: { backgroundColor: '#1b6ef3', paddingVertical: 18, paddingHorizontal: 40, borderRadius: 40 },
  stop: { backgroundColor: '#d33' },
  bigButtonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  linkButton: { padding: 8 },
  link: { color: '#1b6ef3', fontSize: 15 },
  status: { color: '#555', fontSize: 14 },
  warn: { color: '#d33', fontWeight: '600' },
  meterTrack: { width: '100%', height: 14, backgroundColor: '#eee', borderRadius: 7, overflow: 'hidden' },
  meterFill: { height: '100%' },
  section: { fontSize: 13, fontWeight: '600', color: '#888', textTransform: 'uppercase', marginTop: 10 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, fontSize: 15 },
  hint: { color: '#888', fontSize: 12, lineHeight: 17 },
  toolbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1, borderColor: '#eee' },
  toolButton: { padding: 8 },
  toolText: { color: '#1b6ef3', fontSize: 16 },
  toolInfo: { flex: 1, color: '#555', fontSize: 13, textAlign: 'right', paddingRight: 8 },
  web: { flex: 1, backgroundColor: '#fff' },
  controls: { borderTopWidth: 1, borderColor: '#eee', paddingHorizontal: 8, paddingTop: 6 },
  stepper: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, gap: 6 },
  stepperLabel: { width: 52, color: '#555', fontSize: 13 },
  stepButton: { minWidth: 40, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#f0f2f5', alignItems: 'center' },
  stepText: { fontSize: 16 },
  stepValue: { minWidth: 56, textAlign: 'center', fontSize: 15, fontVariant: ['tabular-nums'] },
  exports: { flexDirection: 'row', gap: 8, padding: 8 },
  exportButton: { flex: 1, backgroundColor: '#1b6ef3', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  exportText: { color: '#fff', fontWeight: '600' },
});
