import { contextBridge, ipcRenderer } from "electron";

const api = {
  // Settings
  settings: {
    getAll: () => ipcRenderer.invoke("settings:get-all"),
    get: (key: string) => ipcRenderer.invoke("settings:get", key),
    set: (key: string, value: string) =>
      ipcRenderer.invoke("settings:set", key, value),
  },

  // Prompts
  prompts: {
    getAll: () => ipcRenderer.invoke("prompts:get-all"),
    set: (key: string, systemPrompt: string, modelOverride?: string) =>
      ipcRenderer.invoke("prompts:set", key, systemPrompt, modelOverride),
  },

  // Queue
  queue: {
    list: (status?: string) => ipcRenderer.invoke("queue:list", status),
    approve: (id: number) => ipcRenderer.invoke("queue:approve", id),
    reject: (id: number) => ipcRenderer.invoke("queue:reject", id),
    updateParsed: (id: number, parsedData: string) =>
      ipcRenderer.invoke("queue:update-parsed", id, parsedData),
    retry: (id: number) => ipcRenderer.invoke("queue:retry", id),
    stats: () => ipcRenderer.invoke("queue:stats"),
  },

  // TDLib / Telegram
  tdlib: {
    getAuthState: () => ipcRenderer.invoke("tdlib:get-auth-state"),
    connect: (apiId: number, apiHash: string) =>
      ipcRenderer.invoke("tdlib:connect", apiId, apiHash),
    sendPhone: (phone: string) => ipcRenderer.send("tdlib:send-phone", phone),
    sendCode: (code: string) => ipcRenderer.send("tdlib:send-code", code),
    sendPassword: (password: string) =>
      ipcRenderer.send("tdlib:send-password", password),
    disconnect: () => ipcRenderer.invoke("tdlib:disconnect"),
    getChats: () => ipcRenderer.invoke("tdlib:get-chats"),
    addChat: (chatId: number, title: string) =>
      ipcRenderer.invoke("tdlib:add-chat", chatId, title),
    removeChat: (chatId: number) =>
      ipcRenderer.invoke("tdlib:remove-chat", chatId),
    getMonitoredChats: () => ipcRenderer.invoke("tdlib:get-monitored-chats"),
    setCollectFrom: (chatId: number, date: string) =>
      ipcRenderer.invoke("tdlib:set-collect-from", chatId, date),
    syncHistory: (chatId: number) =>
      ipcRenderer.invoke("tdlib:sync-history", chatId),
    getUsername: (userId: number) =>
      ipcRenderer.invoke("tdlib:get-username", userId),
  },

  // Pipeline
  pipeline: {
    process: (msg: any) => ipcRenderer.invoke("pipeline:process", msg),
    reprocess: (id: number) => ipcRenderer.invoke("pipeline:reprocess", id),
    resetProvider: () => ipcRenderer.invoke("pipeline:reset-provider"),
    cleanDedup: () => ipcRenderer.invoke("pipeline:clean-dedup"),
  },

  // API client
  api: {
    deliverNow: () => ipcRenderer.invoke("api:deliver-now"),
    testConnection: () => ipcRenderer.invoke("api:test-connection"),
    startDelivery: () => ipcRenderer.invoke("api:start-delivery"),
    stopDelivery: () => ipcRenderer.invoke("api:stop-delivery"),
  },

  // App
  app: {
    restart: () => ipcRenderer.invoke("app:restart"),
  },

  // Events from main process
  on: (channel: string, callback: (...args: any[]) => void) => {
    const subscription = (_event: any, ...args: any[]) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },
};

contextBridge.exposeInMainWorld("api", api);

export type ElectronAPI = typeof api;
