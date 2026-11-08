// The page the app's WebView shows. It loads OpenSheetMusicDisplay from a CDN
// and renders whatever MusicXML it is handed through window.setScore(xml) or a
// postMessage from React Native. Shared with scripts/render-sample.mjs so the
// desktop preview is the same page the phone draws.

export const OSMD_VERSION = '1.9.0';

export const OSMD_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=4, user-scalable=yes">
<style>
  html, body { margin: 0; padding: 0; background: #fff; }
  #status { font: 14px -apple-system, Roboto, sans-serif; color: #666; padding: 16px; }
  #osmd { padding: 8px 4px 48px; }
</style>
<script src="https://cdn.jsdelivr.net/npm/opensheetmusicdisplay@${OSMD_VERSION}/build/opensheetmusicdisplay.min.js"></script>
</head>
<body>
<div id="status">Waiting for a score…</div>
<div id="osmd"></div>
<script>
  var osmd = null;
  var pending = null;
  var zoom = 0.7;

  function post(msg) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }

  function ensure() {
    if (osmd) return osmd;
    if (!window.opensheetmusicdisplay) return null;
    osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay('osmd', {
      autoResize: true,
      backend: 'svg',
      drawTitle: true,
      drawingParameters: 'compacttight',
      autoBeam: true,
      newSystemFromXML: false,
    });
    return osmd;
  }

  window.setScore = function (xml) {
    var o = ensure();
    if (!o) { pending = xml; return; }
    document.getElementById('status').textContent = 'Rendering…';
    o.load(xml).then(function () {
      o.zoom = zoom;
      o.render();
      document.getElementById('status').style.display = 'none';
      post({ type: 'rendered' });
    }).catch(function (err) {
      document.getElementById('status').textContent = 'Could not render: ' + err;
      post({ type: 'error', message: String(err) });
    });
  };

  // Playback: a plain Web Audio tone per note, enough to hear whether the
  // melody is right. Two oscillators (fundamental + quiet octave) through a
  // percussive envelope, scheduled all at once on the context clock.
  var audio = null;
  var stopTimer = null;

  window.play = function (events, tempoScale) {
    window.stop();
    if (!events || !events.length) { post({ type: 'stopped' }); return; }
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { post({ type: 'error', message: 'No Web Audio in this WebView' }); return; }
    audio = new Ctx();
    var scale = tempoScale || 1;
    var master = audio.createGain();
    master.gain.value = 0.5;
    var comp = audio.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(audio.destination);
    var start = audio.currentTime + 0.15;
    var end = 0;
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      var t = start + e.t * scale;
      var dur = Math.max(0.08, Math.min(e.dur * scale, 4));
      var vel = Math.max(0.15, Math.min(1, (e.velocity || 80) / 127));
      var freq = 440 * Math.pow(2, (e.pitch - 69) / 12);
      var g = audio.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35 * vel, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.12 * vel, t + Math.min(0.25, dur * 0.5));
      g.gain.setValueAtTime(0.12 * vel, t + dur - 0.03 > t + 0.01 ? t + dur - 0.03 : t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
      g.connect(master);
      var o1 = audio.createOscillator();
      o1.type = 'triangle';
      o1.frequency.value = freq;
      o1.connect(g);
      var o2g = audio.createGain();
      o2g.gain.value = 0.18;
      var o2 = audio.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = freq * 2;
      o2.connect(o2g);
      o2g.connect(g);
      o1.start(t); o2.start(t);
      o1.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
      if (t + dur > end) end = t + dur;
    }
    if (audio.state === 'suspended') audio.resume().catch(function () {});
    post({ type: 'playing' });
    stopTimer = setTimeout(window.stop, Math.ceil((end - audio.currentTime + 0.3) * 1000));
  };

  window.stop = function () {
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
    if (audio) { try { audio.close(); } catch (e) {} audio = null; post({ type: 'stopped' }); }
  };

  window.setZoom = function (z) {
    zoom = z;
    if (osmd && osmd.IsReadyToRender()) { osmd.zoom = z; osmd.render(); }
  };

  function onMessage(ev) {
    try {
      var msg = JSON.parse(ev.data);
      if (msg.type === 'score') window.setScore(msg.xml);
      if (msg.type === 'zoom') window.setZoom(msg.zoom);
      if (msg.type === 'play') window.play(msg.events, msg.tempoScale);
      if (msg.type === 'stop') window.stop();
    } catch (e) {}
  }
  document.addEventListener('message', onMessage); // Android
  window.addEventListener('message', onMessage);   // iOS

  window.addEventListener('load', function () {
    if (pending) { var x = pending; pending = null; window.setScore(x); }
    post({ type: 'ready' });
  });
</script>
</body>
</html>`;
