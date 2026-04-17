import { useState, useEffect } from "react";

interface MonitoredChat {
  id: number;
  chat_id: number;
  title: string;
  thread_id: number | null;
  thread_title: string | null;
  last_processed_message_id: number | null;
  collect_from_date: string | null;
  added_at: string;
}

interface TelegramChat {
  id: number;
  title: string;
  type: string;
  isForum?: boolean;
}

interface ForumTopic {
  threadId: number;
  title: string;
}

export default function ChatManager() {
  const [authState, setAuthState] = useState("idle");
  const [monitoredChats, setMonitoredChats] = useState<MonitoredChat[]>([]);
  const [chatStats, setChatStats] = useState<Record<number, Record<string, number>>>({});
  const [availableChats, setAvailableChats] = useState<TelegramChat[]>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Topic-picker step
  const [pendingChat, setPendingChat] = useState<TelegramChat | null>(null);
  const [topics, setTopics] = useState<ForumTopic[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(false);

  // Auth form state
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [authHint, setAuthHint] = useState("");

  useEffect(() => {
    window.api.tdlib.getAuthState().then(setAuthState);
    window.api.settings.getAll().then((s) => {
      if (s.tdlib_api_id) setApiId(s.tdlib_api_id);
      if (s.tdlib_api_hash) setApiHash(s.tdlib_api_hash);
    });
    loadMonitoredChats();

    const unsub = window.api.on("tdlib:auth-state", (state: string, hint?: string) => {
      setAuthState(state);
      if (hint) setAuthHint(hint);
    });

    return unsub;
  }, []);

  const loadMonitoredChats = () => {
    window.api.tdlib.getMonitoredChats().then(setMonitoredChats);
    window.api.tdlib.getAllChatStats().then(setChatStats);
  };

  const handleConnect = async () => {
    const id = parseInt(apiId);
    if (!id || !apiHash) return;
    await window.api.settings.set("tdlib_api_id", apiId);
    await window.api.settings.set("tdlib_api_hash", apiHash);
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

  const closeDialog = () => {
    setShowAddDialog(false);
    setPendingChat(null);
    setTopics([]);
    setSearchQuery("");
  };

  const selectChat = async (chat: TelegramChat) => {
    if (chat.isForum) {
      setPendingChat(chat);
      setTopicsLoading(true);
      try {
        const list = await window.api.tdlib.getForumTopics(chat.id);
        setTopics(list);
      } finally {
        setTopicsLoading(false);
      }
    } else {
      await window.api.tdlib.addChat(chat.id, chat.title, null, null);
      loadMonitoredChats();
      closeDialog();
    }
  };

  const subscribeWholeChat = async () => {
    if (!pendingChat) return;
    await window.api.tdlib.addChat(pendingChat.id, pendingChat.title, null, null);
    loadMonitoredChats();
    closeDialog();
  };

  const subscribeTopic = async (topic: ForumTopic) => {
    if (!pendingChat) return;
    await window.api.tdlib.addChat(
      pendingChat.id,
      pendingChat.title,
      topic.threadId,
      topic.title
    );
    loadMonitoredChats();
    closeDialog();
  };

  const removeChat = async (id: number) => {
    await window.api.tdlib.removeChat(id);
    loadMonitoredChats();
  };

  const setCollectFrom = async (id: number, date: string) => {
    await window.api.tdlib.setCollectFrom(id, date);
    loadMonitoredChats();
  };

  const syncHistory = async (id: number) => {
    const result = await window.api.tdlib.syncHistory(id);
    alert(`Синхронизировано ${result.synced} сообщений`);
  };

  // Sets for marking already-added chats/topics in the add dialog
  const monitoredChatIds = new Set(monitoredChats.map((c) => c.chat_id));
  const monitoredTopicKeys = new Set(
    monitoredChats
      .filter((c) => c.thread_id !== null)
      .map((c) => `${c.chat_id}:${c.thread_id}`)
  );
  const isWholeMonitored = (chatId: number) =>
    monitoredChats.some((c) => c.chat_id === chatId && c.thread_id === null);

  const filteredChats = availableChats.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

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

      {monitoredChats.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          Нет отслеживаемых чатов. Нажмите "Добавить чат" чтобы начать.
        </div>
      ) : (
        <div className="space-y-2">
          {monitoredChats.map((chat) => (
            <div
              key={chat.id}
              className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {chat.title}
                  {chat.thread_title && (
                    <span className="text-blue-600 font-normal">
                      {" "}
                      › {chat.thread_title}
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-gray-400">
                  Добавлен: {chat.added_at}
                  {chat.last_processed_message_id &&
                    ` · Последний ID: ${chat.last_processed_message_id}`}
                </p>
                {(() => {
                  const s = chatStats[chat.chat_id];
                  if (!s) return null;
                  return (
                    <p className="text-[11px] text-gray-400 flex gap-2">
                      {s.processed ? <span className="text-green-600">{s.processed} обработано</span> : null}
                      {s.skipped ? <span className="text-gray-400">{s.skipped} пропущено</span> : null}
                      {s.errors ? <span className="text-red-500">{s.errors} ошибок</span> : null}
                    </p>
                  );
                })()}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={chat.collect_from_date || ""}
                  onChange={(e) => setCollectFrom(chat.id, e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1 text-xs"
                  title="Собирать с"
                />
                <button
                  onClick={() => syncHistory(chat.id)}
                  className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-700 hover:bg-blue-200"
                  title="Синхронизировать историю"
                >
                  Синхр.
                </button>
                <button
                  onClick={() => removeChat(chat.id)}
                  className="rounded bg-red-100 px-2 py-1 text-xs text-red-700 hover:bg-red-200"
                >
                  Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">
                {pendingChat ? `Темы: ${pendingChat.title}` : "Выберите чат"}
              </h3>
              <button
                onClick={closeDialog}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            {!pendingChat && (
              <>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Поиск..."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm mb-3"
                />

                <div className="max-h-80 overflow-y-auto space-y-1">
                  {filteredChats.map((chat) => {
                    const added = !chat.isForum && monitoredChatIds.has(chat.id);
                    const partiallyAdded = chat.isForum && monitoredChatIds.has(chat.id);
                    return (
                      <button
                        key={chat.id}
                        onClick={() => !added && selectChat(chat)}
                        className={`w-full text-left rounded-lg px-3 py-2 text-sm flex items-center justify-between ${
                          added
                            ? "bg-green-50 text-green-700 cursor-default"
                            : "hover:bg-blue-50"
                        }`}
                        disabled={added}
                      >
                        <span>
                          <span className="font-medium">{chat.title}</span>
                          {chat.isForum && (
                            <span className="ml-2 text-[10px] text-blue-600">
                              (форум)
                            </span>
                          )}
                        </span>
                        {added && (
                          <span className="text-[10px] text-green-600 whitespace-nowrap ml-2">
                            ✓ Добавлен
                          </span>
                        )}
                        {partiallyAdded && (
                          <span className="text-[10px] text-amber-600 whitespace-nowrap ml-2">
                            частично
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
              </>
            )}

            {pendingChat && (
              <>
                {topicsLoading ? (
                  <p className="text-sm text-gray-500 text-center py-6">
                    Загрузка тем...
                  </p>
                ) : (
                  <>
                    {(() => {
                      const wholeAdded = pendingChat && isWholeMonitored(pendingChat.id);
                      return (
                        <button
                          onClick={() => !wholeAdded && subscribeWholeChat()}
                          className={`w-full text-left rounded-lg px-3 py-2 text-sm border border-dashed mb-2 flex items-center justify-between ${
                            wholeAdded
                              ? "border-green-300 bg-green-50 text-green-700 cursor-default"
                              : "border-gray-300 hover:bg-blue-50"
                          }`}
                          disabled={!!wholeAdded}
                        >
                          <span>
                            <span className="font-medium">📢 Весь чат</span>
                            <span className="block text-[11px] text-gray-500">
                              Подписаться на все темы
                            </span>
                          </span>
                          {wholeAdded && (
                            <span className="text-[10px] text-green-600">✓ Добавлен</span>
                          )}
                        </button>
                      );
                    })()}
                    <div className="max-h-72 overflow-y-auto space-y-1">
                      {topics.map((t) => {
                        const topicAdded = pendingChat && monitoredTopicKeys.has(`${pendingChat.id}:${t.threadId}`);
                        return (
                          <button
                            key={t.threadId}
                            onClick={() => !topicAdded && subscribeTopic(t)}
                            className={`w-full text-left rounded-lg px-3 py-2 text-sm flex items-center justify-between ${
                              topicAdded
                                ? "bg-green-50 text-green-700 cursor-default"
                                : "hover:bg-blue-50"
                            }`}
                            disabled={!!topicAdded}
                          >
                            <span>{t.title}</span>
                            {topicAdded && (
                              <span className="text-[10px] text-green-600">✓ Добавлена</span>
                            )}
                          </button>
                        );
                      })}
                      {topics.length === 0 && (
                        <p className="text-sm text-gray-400 text-center py-4">
                          Темы не найдены
                        </p>
                      )}
                    </div>
                  </>
                )}
                <button
                  onClick={() => {
                    setPendingChat(null);
                    setTopics([]);
                  }}
                  className="mt-3 text-xs text-gray-500 hover:text-gray-700"
                >
                  ← Назад к списку чатов
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
