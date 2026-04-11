import { useState, useEffect } from "react";

interface MonitoredChat {
  chat_id: number;
  title: string;
  last_processed_message_id: number | null;
  collect_from_date: string | null;
  added_at: string;
}

interface TelegramChat {
  id: number;
  title: string;
  type: string;
}

export default function ChatManager() {
  const [authState, setAuthState] = useState("idle");
  const [monitoredChats, setMonitoredChats] = useState<MonitoredChat[]>([]);
  const [availableChats, setAvailableChats] = useState<TelegramChat[]>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Auth form state
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [authHint, setAuthHint] = useState("");

  useEffect(() => {
    window.api.tdlib.getAuthState().then(setAuthState);
    loadMonitoredChats();

    const unsub = window.api.on("tdlib:auth-state", (state: string, hint?: string) => {
      setAuthState(state);
      if (hint) setAuthHint(hint);
    });

    return unsub;
  }, []);

  const loadMonitoredChats = () => {
    window.api.tdlib.getMonitoredChats().then(setMonitoredChats);
  };

  const handleConnect = async () => {
    const id = parseInt(apiId);
    if (!id || !apiHash) return;
    await window.api.tdlib.connect(id, apiHash);
  };

  const handleSendPhone = () => {
    if (!phone) return;
    window.api.tdlib.sendPhone(phone);
  };

  const handleSendCode = () => {
    if (!code) return;
    window.api.tdlib.sendCode(code);
  };

  const handleSendPassword = () => {
    if (!password) return;
    window.api.tdlib.sendPassword(password);
  };

  const handleDisconnect = () => {
    window.api.tdlib.disconnect();
  };

  const openAddDialog = async () => {
    const chats = await window.api.tdlib.getChats();
    setAvailableChats(chats);
    setShowAddDialog(true);
  };

  const addChat = async (chat: TelegramChat) => {
    await window.api.tdlib.addChat(chat.id, chat.title);
    loadMonitoredChats();
    setShowAddDialog(false);
  };

  const removeChat = async (chatId: number) => {
    await window.api.tdlib.removeChat(chatId);
    loadMonitoredChats();
  };

  const setCollectFrom = async (chatId: number, date: string) => {
    await window.api.tdlib.setCollectFrom(chatId, date);
    loadMonitoredChats();
  };

  const syncHistory = async (chatId: number) => {
    const result = await window.api.tdlib.syncHistory(chatId);
    alert(`Синхронизировано ${result.synced} сообщений`);
  };

  const filteredChats = availableChats.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Auth UI
  if (authState !== "ready") {
    return (
      <div className="p-6 max-w-md mx-auto">
        <h2 className="text-xl font-bold mb-6">Подключение к Telegram</h2>

        {authState === "idle" && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Введите API credentials с{" "}
              <span className="text-blue-600">my.telegram.org</span>
            </p>
            <div>
              <label className="block text-xs text-gray-500 mb-1">API ID</label>
              <input
                type="number"
                value={apiId}
                onChange={(e) => setApiId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="12345678"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">API Hash</label>
              <input
                type="text"
                value={apiHash}
                onChange={(e) => setApiHash(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="0123456789abcdef..."
              />
            </div>
            <button
              onClick={handleConnect}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
            >
              Подключить
            </button>
          </div>
        )}

        {authState === "waitPhoneNumber" && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Введите номер телефона</p>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="+7 777 123 45 67"
            />
            <button
              onClick={handleSendPhone}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
            >
              Отправить
            </button>
          </div>
        )}

        {authState === "waitCode" && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Введите код из Telegram</p>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-center text-lg tracking-widest"
              placeholder="12345"
              maxLength={6}
            />
            <button
              onClick={handleSendCode}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
            >
              Подтвердить
            </button>
          </div>
        )}

        {authState === "waitPassword" && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Введите пароль двухфакторной аутентификации
              {authHint && (
                <span className="block text-xs text-gray-400 mt-1">
                  Подсказка: {authHint}
                </span>
              )}
            </p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              onClick={handleSendPassword}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
            >
              Подтвердить
            </button>
          </div>
        )}

        {authState === "connecting" && (
          <div className="text-center text-sm text-gray-500">
            Подключение...
          </div>
        )}

        {authState === "error" && (
          <div className="space-y-4">
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              Ошибка подключения. Попробуйте снова.
            </div>
            <button
              onClick={() => setAuthState("idle")}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
            >
              Повторить
            </button>
          </div>
        )}
      </div>
    );
  }

  // Chat management UI (when connected)
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">Управление чатами</h2>
        <div className="flex gap-2">
          <button
            onClick={openAddDialog}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
          >
            + Добавить чат
          </button>
          <button
            onClick={handleDisconnect}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Отключить Telegram
          </button>
        </div>
      </div>

      {/* Monitored chats list */}
      {monitoredChats.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          Нет отслеживаемых чатов. Нажмите "Добавить чат" чтобы начать.
        </div>
      ) : (
        <div className="space-y-2">
          {monitoredChats.map((chat) => (
            <div
              key={chat.chat_id}
              className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{chat.title}</p>
                <p className="text-[11px] text-gray-400">
                  Добавлен: {chat.added_at}
                  {chat.last_processed_message_id &&
                    ` · Последний ID: ${chat.last_processed_message_id}`}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={chat.collect_from_date || ""}
                  onChange={(e) =>
                    setCollectFrom(chat.chat_id, e.target.value)
                  }
                  className="rounded border border-gray-300 px-2 py-1 text-xs"
                  title="Собирать с"
                />
                <button
                  onClick={() => syncHistory(chat.chat_id)}
                  className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-700 hover:bg-blue-200"
                  title="Синхронизировать историю"
                >
                  Синхр.
                </button>
                <button
                  onClick={() => removeChat(chat.chat_id)}
                  className="rounded bg-red-100 px-2 py-1 text-xs text-red-700 hover:bg-red-200"
                >
                  Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add chat dialog */}
      {showAddDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">Выберите чат</h3>
              <button
                onClick={() => setShowAddDialog(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm mb-3"
            />

            <div className="max-h-80 overflow-y-auto space-y-1">
              {filteredChats.map((chat) => {
                const isMonitored = monitoredChats.some(
                  (m) => m.chat_id === chat.id
                );
                return (
                  <button
                    key={chat.id}
                    disabled={isMonitored}
                    onClick={() => addChat(chat)}
                    className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors ${
                      isMonitored
                        ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                        : "hover:bg-blue-50"
                    }`}
                  >
                    <span className="font-medium">{chat.title}</span>
                    {isMonitored && (
                      <span className="ml-2 text-[10px]">
                        (уже отслеживается)
                      </span>
                    )}
                  </button>
                );
              })}
              {filteredChats.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">
                  Чаты не найдены
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
