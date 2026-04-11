import { useState, useEffect } from "react";

interface QueueItem {
  id: number;
  raw_text: string;
  parsed_data: string;
  status: string;
  error: string | null;
  retry_count: number;
  created_at: string;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + "Z"); // SQLite stores UTC without Z
    return d.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

const statusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: "Ожидает", color: "bg-blue-100 text-blue-700" },
  review: { label: "На модерации", color: "bg-yellow-100 text-yellow-700" },
  approved: { label: "Одобрено", color: "bg-green-100 text-green-700" },
  delivered: { label: "Доставлено", color: "bg-green-100 text-green-700" },
  failed: { label: "Ошибка", color: "bg-red-100 text-red-700" },
  ai_failed: { label: "Ошибка ИИ", color: "bg-orange-100 text-orange-700" },
};

export default function Queue() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = () => {
    window.api.queue.list(filter || undefined).then(setItems);
  };

  useEffect(() => {
    load();
  }, [filter]);

  const handleApprove = async (id: number) => {
    await window.api.queue.approve(id);
    load();
  };

  const handleReject = async (id: number) => {
    await window.api.queue.reject(id);
    load();
  };

  const handleRetry = async (id: number) => {
    await window.api.queue.retry(id);
    load();
  };

  const handleReprocess = async (id: number) => {
    const result = await window.api.pipeline.reprocess(id);
    if (result.ok) {
      load();
    } else {
      alert(`Ошибка перепроверки: ${result.error}`);
    }
  };

  // Auto-refresh when new items arrive
  useEffect(() => {
    const unsub = window.api.on("pipeline:event", () => {
      load();
    });
    return unsub;
  }, [filter]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Очередь</h2>
        <button
          onClick={load}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
        >
          Обновить
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 text-xs">
        {[
          { key: "", label: "Все" },
          { key: "review", label: "На модерации" },
          { key: "pending", label: "Ожидают" },
          { key: "delivered", label: "Доставлено" },
          { key: "failed", label: "Ошибки" },
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

      {/* Items */}
      {items.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          Очередь пуста
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const parsed = JSON.parse(item.parsed_data || "{}");
            const st = statusLabels[item.status] ?? {
              label: item.status,
              color: "bg-gray-100 text-gray-700",
            };

            return (
              <div
                key={item.id}
                className="rounded-xl border border-gray-200 bg-white overflow-hidden"
              >
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50"
                  onClick={() =>
                    setExpanded(expanded === item.id ? null : item.id)
                  }
                >
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${st.color}`}
                  >
                    {st.label}
                  </span>
                  <span className="text-sm font-medium truncate flex-1">
                    {parsed.title ?? "Без заголовка"}
                  </span>
                  <span className="text-[10px] text-gray-400 shrink-0">
                    {formatDate(item.created_at)}
                  </span>
                </div>

                {expanded === item.id && (
                  <div className="border-t border-gray-200 p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-gray-500 mb-1 font-medium">
                          Оригинал
                        </p>
                        <pre className="text-xs bg-gray-50 rounded p-2 whitespace-pre-wrap max-h-48 overflow-y-auto">
                          {item.raw_text}
                        </pre>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1 font-medium">
                          Распарсено (JSON)
                        </p>
                        <pre className="text-xs bg-gray-50 rounded p-2 whitespace-pre-wrap max-h-48 overflow-y-auto">
                          {JSON.stringify(parsed, null, 2)}
                        </pre>
                      </div>
                    </div>

                    {item.error && (
                      <div className="text-xs text-red-600 bg-red-50 rounded p-2">
                        {item.error}
                      </div>
                    )}

                    <div className="flex gap-2">
                      {(item.status === "review" ||
                        item.status === "ai_failed") && (
                        <button
                          onClick={() => handleApprove(item.id)}
                          className="rounded bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-700"
                        >
                          Одобрить
                        </button>
                      )}
                      <button
                        onClick={() => handleReprocess(item.id)}
                        className="rounded bg-purple-600 px-3 py-1.5 text-xs text-white hover:bg-purple-700"
                      >
                        Перепроверить
                      </button>
                      {item.status === "review" && (
                        <button
                          onClick={() => handleReject(item.id)}
                          className="rounded bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-700"
                        >
                          Отклонить
                        </button>
                      )}
                      {(item.status === "failed" ||
                        item.status === "ai_failed") && (
                        <button
                          onClick={() => handleRetry(item.id)}
                          className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
                        >
                          Повторить
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
