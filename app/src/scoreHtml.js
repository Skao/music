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

  window.setZoom = function (z) {
    zoom = z;
    if (osmd && osmd.IsReadyToRender()) { osmd.zoom = z; osmd.render(); }
  };

  function onMessage(ev) {
    try {
      var msg = JSON.parse(ev.data);
      if (msg.type === 'score') window.setScore(msg.xml);
      if (msg.type === 'zoom') window.setZoom(msg.zoom);
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
