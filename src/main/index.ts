import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import { initDb } from "./db/sqlite";
import { registerSettingsHandlers } from "./services/settings.service";
import { registerQueueHandlers } from "./services/queue.service";
import { registerTdlibHandlers } from "./services/tdlib.service";
import { registerPipelineHandlers } from "./services/pipeline.service";
import { registerApiClientHandlers } from "./services/api-client.service";

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "CastHub Parser",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    await initDb();
    registerSettingsHandlers();
    registerQueueHandlers();
    registerTdlibHandlers();
    registerPipelineHandlers();
    registerApiClientHandlers();
  } catch (err) {
    console.error("Init error (non-fatal):", err);
  }

  // Restart handler
  ipcMain.handle("app:restart", () => {
    app.relaunch();
    app.exit(0);
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
