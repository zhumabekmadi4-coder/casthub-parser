import { app, BrowserWindow } from "electron";
import * as path from "path";

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

app.whenReady().then(() => {
  try {
    const { initDb } = require("./db/sqlite");
    initDb();

    const { registerSettingsHandlers } = require("./services/settings.service");
    const { registerQueueHandlers } = require("./services/queue.service");
    const { registerTdlibHandlers } = require("./services/tdlib.service");
    const { registerPipelineHandlers } = require("./services/pipeline.service");
    const { registerApiClientHandlers } = require("./services/api-client.service");

    registerSettingsHandlers();
    registerQueueHandlers();
    registerTdlibHandlers();
    registerPipelineHandlers();
    registerApiClientHandlers();
  } catch (err) {
    console.error("Init error (non-fatal):", err);
  }

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
