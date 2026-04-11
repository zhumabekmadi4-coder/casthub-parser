import { useState, useEffect, useRef } from "react";

interface LogEntry {
  type: string;
  time: string;
  [key: string]: any;
}

const typeLabels: Record<string, { label: string; color: string; icon: string }> = {
  incoming: { label: "Входящее", color: "text-blue-600", icon: "📨" },
  processed: { label: "Обработано", color: "text-green-600", icon: "✅" },
  delivered: { label: "Доставлено", color: "text-green-700", icon: "📤" },
  skipped: { label: "Пропущено", color: "text-gray-500", icon: "⏭️" },
  error: { label: "Ошибка", color: "text-red-600", icon: "❌" },
};

export default function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<string>("");
  const logsRef = useRef<LogEntry[]>([]);

  useEffect(() => {
    const unsub = window.api.on("pipeline:event", (event: any) => {
      const entry: LogEntry = {
        ...event,
        time: new Date().toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      };
      const updated = [entry, ...logsRef.current].slice(0, 500);
      logsRef.current = updated;
      setLogs(updated);
    });

    return unsub;
  }, []);

  const filtered = filter
    ? logs.filter((l) => l.type === filter)
    : logs;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Логи</h2>
        <div className="flex gap-2">
          <button
            onClick={() => { logsRef.current = []; setLogs([]); }}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            Очистить
          </button>
          <span className="text-xs text-gray-400 self-center">
            {logs.length} записей
          </span>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-1 mb-4 text-xs">
        {[
          { key: "", label: "Все" },
          { key: "incoming", label: "📨 Входящие" },
          { key: "processed", label: "✅ Обработано" },
          { key: "skipped", label: "⏭️ Пропущено" },
          { key: "delivered", label: "📤 Доставлено" },
          { key: "error", label: "❌ Ошибки" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              filter === tab.key
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Log entries */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          {logs.length === 0
            ? "Логи появятся когда начнут приходить сообщения из Telegram"
            : "Нет записей с выбранным фильтром"}
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-50 max-h-[calc(100vh-200px)] overflow-y-auto">
          {filtered.map((log, i) => {
            const meta = typeLabels[log.type] ?? {
              label: log.type,
              color: "text-gray-600",
              icon: "📋",
            };

            return (
              <div key={i} className="px-3 py-2 flex items-start gap-2 text-xs hover:bg-gray-50">
                <span className="shrink-0">{meta.icon}</span>
                <span className="text-gray-400 shrink-0 w-16">{log.time}</span>
                <span className={`shrink-0 w-24 font-medium ${meta.color}`}>
                  {meta.label}
                </span>
                <span className="text-gray-700 min-w-0">
                  {log.type === "incoming" && (
                    <>Сообщение ({log.textLength} симв.) из чата {log.chatId}</>
                  )}
                  {log.type === "processed" && (
                    <>
                      <span className="font-medium">{log.title}</span>
                      {" — "}
                      {log.classification === "casting" ? "кастинг" : "работа"}
                      {log.rolesCount > 0 && `, ${log.rolesCount} ролей`}
                      {log.vacanciesCount > 0 && `, ${log.vacanciesCount} вакансий`}
                    </>
                  )}
                  {log.type === "skipped" && (
                    <>
                      {log.reason === "duplicate"
                        ? "Дубликат"
                        : log.reason === "irrelevant"
                          ? "Нерелевантно"
                          : log.reason === "no_contacts"
                            ? "Нет контактов"
                            : log.reason}
                      {log.preview && (
                        <span className="text-gray-400 ml-1 truncate">
                          «{log.preview}»
                        </span>
                      )}
                    </>
                  )}
                  {log.type === "delivered" && (
                    <>Доставлено: <span className="font-medium">{log.title}</span></>
                  )}
                  {log.type === "error" && (
                    <span className="text-red-600">{log.error}</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
