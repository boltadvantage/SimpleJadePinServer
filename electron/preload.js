/* Minimal bridge. Exposes exactly one action, no general IPC surface. */
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("boltJade", {
  isDesktopApp: true,
  openDataDir: () => ipcRenderer.invoke("open-data-dir"),
});
