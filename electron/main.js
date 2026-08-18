/* Bolt Advantage — Jade PIN Server desktop shell.
 *
 * Owns three jobs:
 *   1. supervise the bundled PIN server sidecar,
 *   2. grant camera access to our own local page and nothing else,
 *   3. make it structurally impossible for this app to reach the network.
 */

"use strict";

const { app, BrowserWindow, session, shell, ipcMain, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const net = require("net");

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";

let mainWindow = null;
let serverProc = null;
let serverOrigin = null;
let serverPort = null;
let dataDir = null;
let startupLog = [];

/* ── Offline enforcement ──────────────────────────────────────────────
 * The app must never contact anything but its own loopback server. This
 * is belt-and-braces alongside the page CSP: even a compromised renderer
 * cannot originate an outbound request.
 */
function lockdownNetwork(ses) {
  ses.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (details, callback) => {
    let host;
    try {
      host = new URL(details.url).hostname;
    } catch {
      return callback({ cancel: true });
    }

    const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";

    if (!loopback) {
      console.warn("[offline] blocked outbound request:", details.url);
      return callback({ cancel: true });
    }
    callback({ cancel: false });
  });

  // Deny every permission except camera on our own origin.
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (permission !== "media" && permission !== "camera") return callback(false);

    const origin = details && details.requestingUrl ? details.requestingUrl : "";
    const ours = serverOrigin && origin.startsWith(serverOrigin);

    if (!ours) {
      console.warn("[perm] denied", permission, "for", origin);
      return callback(false);
    }
    // Video only. This app never needs a microphone.
    if (details && details.mediaTypes && details.mediaTypes.includes("audio")) {
      return callback(false);
    }
    callback(true);
  });

  ses.setPermissionCheckHandler((wc, permission, origin) => {
    if (permission !== "media" && permission !== "camera") return false;
    return !!(serverOrigin && origin && origin.startsWith(serverOrigin));
  });
}

/* ── Sidecar location ─────────────────────────────────────────────── */
function serverBinaryPath() {
  const exe = IS_WIN ? "SimpleJadePinServer.exe" : "SimpleJadePinServer";

  // Packaged: shipped as an unpacked resource next to the asar.
  const packaged = path.join(process.resourcesPath || "", "server", exe);
  if (fs.existsSync(packaged)) return { cmd: packaged, args: [], frozen: true };

  // Development: run the Python source directly from the repo venv.
  const repoRoot = path.join(__dirname, "..");
  const script = path.join(repoRoot, "SimpleJadePinServer.py");
  const venvPy = IS_WIN
    ? path.join(repoRoot, ".venv", "Scripts", "python.exe")
    : path.join(repoRoot, ".venv", "bin", "python");
  const py = fs.existsSync(venvPy) ? venvPy : "python3";

  return { cmd: py, args: [script], frozen: false };
}

/* The Jade stores a pin server URL when its blind oracle is configured, and in
 * USB/BLE mode Blockstream Green POSTs to exactly that URL. A randomly chosen
 * port would therefore break USB/BLE unlock on every launch, so the standard
 * port is used whenever it is free and an ephemeral one only as a fallback.
 */
const DEFAULT_PORT = 4443;

function tryPort(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", () => resolve(null));
    srv.listen(port, "127.0.0.1", () => {
      const chosen = srv.address().port;
      srv.close(() => resolve(chosen));
    });
  });
}

async function findPort() {
  const preferred = await tryPort(DEFAULT_PORT);
  if (preferred) return preferred;

  console.warn(
    `[port] ${DEFAULT_PORT} is in use; falling back to an ephemeral port. ` +
    "USB and Bluetooth unlock will not work until the app can bind " +
    `${DEFAULT_PORT}, because Green connects to the URL stored on the Jade.`
  );
  const fallback = await tryPort(0);
  if (fallback) return fallback;
  throw new Error("Could not bind any local port.");
}

/* ── Start / supervise the sidecar ────────────────────────────────── */
function startServer() {
  return new Promise(async (resolve, reject) => {
    let port;
    try {
      port = await findPort();
    } catch (e) {
      return reject(new Error("Could not allocate a local port: " + e.message));
    }

    serverPort = port;
    const { cmd, args } = serverBinaryPath();

    // Bind loopback only and disable TLS: 127.0.0.1 is already a secure
    // context, so the camera works without any certificate ceremony.
    const argv = args.concat([
      "--no-tls",
      "--port", String(port),
      "--listen", "127.0.0.1",
    ]);

    serverProc = spawn(cmd, argv, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: Object.assign({}, process.env, { PYTHONUNBUFFERED: "1" }),
    });

    let settled = false;

    const onLine = (line) => {
      startupLog.push(line);
      console.log("[server]", line);

      const m = line.match(/^Data directory:\s*(.+)$/);
      if (m) dataDir = m[1].trim();

      if (!settled && line.startsWith("READY ")) {
        settled = true;
        serverOrigin = "http://127.0.0.1:" + port;
        resolve(serverOrigin);
      }
    };

    const wire = (stream) => {
      let buf = "";
      stream.on("data", (chunk) => {
        buf += chunk.toString();
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          onLine(buf.slice(0, i).replace(/\r$/, ""));
          buf = buf.slice(i + 1);
        }
      });
    };

    wire(serverProc.stdout);
    wire(serverProc.stderr);

    serverProc.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(new Error("Failed to launch the PIN server: " + err.message));
      }
    });

    serverProc.on("exit", (code, signal) => {
      if (!settled) {
        settled = true;
        reject(new Error(
          "The PIN server exited before starting (code " + code +
          (signal ? ", signal " + signal : "") + ").\n\n" +
          startupLog.slice(-12).join("\n")
        ));
      } else if (!app.isQuitting) {
        dialog.showErrorBox(
          "PIN server stopped",
          "The local PIN server exited unexpectedly (code " + code + ").\n\n" +
          startupLog.slice(-12).join("\n")
        );
      }
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("The PIN server did not start within 30 seconds.\n\n" +
                         startupLog.slice(-12).join("\n")));
      }
    }, 30000);
  });
}

function stopServer() {
  if (!serverProc) return;
  try {
    if (IS_WIN) spawn("taskkill", ["/pid", String(serverProc.pid), "/f", "/t"]);
    else serverProc.kill("SIGTERM");
  } catch { /* already gone */ }
  serverProc = null;
}

/* ── Window ───────────────────────────────────────────────────────── */
function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 860,
    minWidth: 720,
    minHeight: 600,
    backgroundColor: "#0d1520",
    title: "Jade PIN Server",
    icon: IS_WIN
      ? path.join(__dirname, "..", "build", "icon.ico")
      : path.join(__dirname, "..", "build", "icon.png"),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadURL(url);

  // External links go to the real browser; this window stays local forever.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https:\/\//.test(target)) shell.openExternal(target);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (!serverOrigin || !target.startsWith(serverOrigin)) {
      event.preventDefault();
      if (/^https:\/\//.test(target)) shell.openExternal(target);
    }
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

function showFatal(err) {
  dialog.showErrorBox("Jade PIN Server could not start", String(err.message || err));
  app.quit();
}

/* ── Lifecycle ────────────────────────────────────────────────────── */
// One instance only — two servers writing the same pin files would be unsafe.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    lockdownNetwork(session.defaultSession);

    ipcMain.handle("open-data-dir", () => {
      if (dataDir && fs.existsSync(dataDir)) {
        shell.openPath(dataDir);
        return true;
      }
      return false;
    });

    try {
      const url = await startServer();
      createWindow(url);
    } catch (err) {
      showFatal(err);
    }
  });

  app.on("before-quit", () => { app.isQuitting = true; stopServer(); });
  app.on("will-quit", stopServer);
  app.on("window-all-closed", () => { if (!IS_MAC) app.quit(); });
  app.on("activate", () => {
    if (mainWindow === null && serverOrigin) createWindow(serverOrigin);
  });
}

process.on("exit", stopServer);
