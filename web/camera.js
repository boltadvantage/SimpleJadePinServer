/* Bolt Advantage — camera + QR capture layer.
 *
 * Upstream called Html5QrcodeScanner directly and swallowed every error
 * (`function error(err) {}`), so any failure — missing library, blocked
 * permission, insecure origin, sandboxed browser — looked identical:
 * a button that did nothing. Every failure path here is surfaced with the
 * actual remedy, and there is always a no-camera fallback.
 */

(function () {
  "use strict";

  var html5qr = null;      // active Html5Qrcode instance
  var running = false;
  var seenFrags = null;    // BC-UR fragment accumulator
  var expectedFrags = 0;

  function el(id) { return document.getElementById(id); }

  function showAlert(kind, title, bodyHtml) {
    var box = el("cam_alert");
    box.className = "alert show " + kind;
    box.innerHTML = "<strong>" + title + "</strong>" + (bodyHtml || "");
  }

  function clearAlert() {
    var box = el("cam_alert");
    box.className = "alert";
    box.innerHTML = "";
  }

  function setProgress(text) {
    el("cam_progress").innerHTML = text;
  }

  /* ── Preflight ──────────────────────────────────────────────────────
   * Catch the three failures that produced silent no-ops upstream,
   * before we ever touch the camera.
   */
  function preflight() {
    if (typeof Html5Qrcode === "undefined") {
      showAlert("err", "QR scanning library failed to load.",
        "<p>The bundled <code>vendor/html5-qrcode.min.js</code> did not load. " +
        "The app cannot scan without it. This is a packaging fault, not a " +
        "camera problem — please report it.</p>");
      return false;
    }

    // getUserMedia only exists in a secure context: https, or a loopback host.
    if (!window.isSecureContext) {
      showAlert("err", "Insecure origin — the browser has disabled camera access.",
        "<p>You are viewing this over <code>" + location.protocol + "//" +
        location.hostname + "</code>. Browsers only expose the camera on " +
        "HTTPS or a loopback address, so <code>navigator.mediaDevices</code> " +
        "does not exist here.</p><ul>" +
        "<li>Open <code>http://127.0.0.1:" + location.port + "</code> on the " +
        "machine itself, or</li>" +
        "<li>run the packaged desktop app, which always uses loopback.</li></ul>");
      return false;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showAlert("err", "This browser exposes no camera API.",
        "<p><code>navigator.mediaDevices.getUserMedia</code> is unavailable. " +
        "Use the packaged desktop app, or a current Firefox/Chromium.</p>");
      return false;
    }

    return true;
  }

  /* Translate getUserMedia failures into the actual fix. */
  function explainCameraError(err) {
    var name = (err && err.name) || "";
    var msg = (err && err.message) || String(err);

    if (name === "NotAllowedError" || name === "SecurityError") {
      showAlert("err", "Camera permission was denied.",
        "<p>Grant camera access and try again.</p><ul>" +
        "<li><b>Desktop app:</b> macOS asks once — if you dismissed it, enable " +
        "it under System Settings → Privacy &amp; Security → Camera.</li>" +
        "<li><b>Browser:</b> click the camera icon in the address bar and allow.</li>" +
        "</ul>");
    } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      showAlert("err", "No camera was detected.",
        "<p>No video input device is visible to this app.</p><ul>" +
        "<li>On Linux, confirm the device exists: <code>ls /dev/video*</code></li>" +
        "<li>Confirm your user is in the <code>video</code> group.</li>" +
        "<li>Or use <b>Scan from image</b> below — no camera required.</li></ul>");
    } else if (name === "NotReadableError" || name === "TrackStartError") {
      showAlert("err", "The camera is in use by another application.",
        "<p>Another program is holding the device. Close any other app using " +
        "the webcam (including Sparrow) and try again.</p>");
    } else if (name === "OverconstrainedError") {
      showAlert("err", "The camera does not support the requested mode.",
        "<p>Pick a different device from the dropdown, or use " +
        "<b>Scan from image</b>.</p>");
    } else {
      showAlert("err", "Could not start the camera.",
        "<p><code>" + name + ": " + msg + "</code></p>" +
        "<p>Use <b>Scan from image</b> below as a fallback.</p>");
    }
  }

  /* ── Device enumeration ─────────────────────────────────────────── */
  function listCameras() {
    if (!preflight()) return;

    setProgress("Looking for cameras…");

    Html5Qrcode.getCameras().then(function (devices) {
      var sel = el("cam_select");
      sel.innerHTML = "";

      if (!devices || devices.length === 0) {
        setProgress("");
        showAlert("warn", "No camera found.",
          "<p>You can still complete this step with <b>Scan from image</b>: " +
          "photograph the Jade screen with a phone, copy the image over, and " +
          "load it here. Or paste the <code>ur:jade-pin</code> text directly.</p>");
        return;
      }

      devices.forEach(function (d, i) {
        var o = document.createElement("option");
        o.value = d.id;
        o.text = d.label || ("Camera " + (i + 1));
        sel.appendChild(o);
      });

      el("cam_picker").style.display = devices.length > 1 ? "block" : "none";
      setProgress("Found <b>" + devices.length + "</b> camera" +
                  (devices.length > 1 ? "s" : "") + ". Ready to scan.");
      clearAlert();
      el("btn_scan").disabled = false;
    }).catch(function (err) {
      setProgress("");
      explainCameraError(err);
    });
  }

  /* ── Scanning ───────────────────────────────────────────────────── */
  function startScan() {
    if (!preflight()) return;
    if (running) return;

    resetFragments();
    clearAlert();

    var sel = el("cam_select");
    var camId = sel.value;

    html5qr = new Html5Qrcode("qrreader1", {
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      verbose: false
    });

    var config = { fps: 10, qrbox: { width: 260, height: 260 } };
    // Fall back to a facingMode constraint when no deviceId is known.
    var source = camId ? camId : { facingMode: "environment" };

    html5qr.start(source, config, onDecoded, function () { /* per-frame miss */ })
      .then(function () {
        running = true;
        el("btn_scan").disabled = true;
        el("btn_stop").disabled = false;
        setProgress("Scanning… point the camera at the Jade screen.");
      })
      .catch(function (err) {
        running = false;
        explainCameraError(err);
      });
  }

  function stopScan(quiet) {
    if (!html5qr || !running) return Promise.resolve();
    running = false;

    return html5qr.stop().then(function () {
      html5qr.clear();
      el("btn_scan").disabled = false;
      el("btn_stop").disabled = true;
      if (!quiet) setProgress("Scanning stopped.");
    }).catch(function () { /* already torn down */ });
  }

  /* ── Fallback: decode a still image, no camera involved ─────────── */
  function scanFile(file) {
    if (!file) return;
    if (typeof Html5Qrcode === "undefined") { preflight(); return; }

    clearAlert();

    var inst = new Html5Qrcode("qrreader1", {
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      verbose: false
    });

    inst.scanFile(file, false).then(function (text) {
      onDecoded(text);
      inst.clear();
    }).catch(function () {
      inst.clear();
      showAlert("warn", "No QR code found in that image.",
        "<p>Make sure the whole QR code is visible, in focus and well lit. " +
        "For multi-part codes, load each frame in turn.</p>");
    });
  }

  /* Manual paste — the last-resort path when there is no camera at all. */
  function submitManual() {
    var text = el("manual_text").value.trim();
    if (!text) return;
    clearAlert();
    text.split(/\s+/).forEach(onDecoded);
  }

  /* ── BC-UR fragment assembly ────────────────────────────────────────
   * Logic preserved from upstream, with progress reporting added.
   */
  function resetFragments() {
    seenFrags = null;
    expectedFrags = 0;
    bcur1_fragments = null;
  }

  function onDecoded(result) {
    var parts = String(result).split("/");

    if (parts[0].toLowerCase() !== "ur:jade-pin") {
      showAlert("warn", "That is not a Jade PIN QR code.",
        "<p>Scanned <code>" + parts[0].substring(0, 40) +
        "</code>. Make sure the Jade is showing Step 1/2.</p>");
      return;
    }

    if (parts.length === 3) {
      // Multi-part: ur:jade-pin/<seq>-<total>/<payload>
      var seqParts = parts[1].split("-");
      var seq = parseInt(seqParts[0], 10);
      var total = parseInt(seqParts[1], 10);

      if (seenFrags === null) {
        seenFrags = new Array(total).fill(null);
        expectedFrags = total;
      }

      seenFrags[seq - 1] = result;

      var have = seenFrags.filter(function (f) { return f !== null; }).length;
      setProgress("Captured <b>" + have + " of " + total + "</b> QR frames…");

      if (have === total) {
        finish(seenFrags);
      }
    } else if (parts.length === 2) {
      // Single-part payload.
      finish([result]);
    }
  }

  function finish(frags) {
    bcur1_fragments = frags;
    stopScan(true);
    setProgress("");
    showAlert("ok", "PIN request captured.",
      "<p>Continue to Step 2 below.</p>");

    try {
      scan_pin_request_done();
    } catch (e) {
      showAlert("err", "Could not decode the captured data.",
        "<p><code>" + e.message + "</code></p>" +
        "<p>Try scanning again — a frame may have been misread.</p>");
    }
  }

  /* ── Wiring ─────────────────────────────────────────────────────── */
  window.addEventListener("DOMContentLoaded", function () {
    el("btn_scan").addEventListener("click", startScan);
    el("btn_stop").addEventListener("click", function () { stopScan(false); });
    el("btn_recheck").addEventListener("click", listCameras);
    el("file_input").addEventListener("change", function (e) {
      scanFile(e.target.files[0]);
    });
    el("btn_manual").addEventListener("click", function () {
      var box = el("manual_box");
      box.style.display = box.style.display === "block" ? "none" : "block";
    });
    el("btn_manual_go").addEventListener("click", submitManual);

    listCameras();
  });
})();
