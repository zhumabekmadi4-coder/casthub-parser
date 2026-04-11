import { useState, useEffect, useRef } from "react";

interface PipelineEvent {
  type: string;
  [key: string]: any;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Record<string, number>>({});
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const eventsRef = useRef<PipelineEvent[]>([]);

  useEffect(() => {
    window.api.queue.stats().then(setStats);

    // Listen for pipeline events
    const unsub = window.api.on("pipeline:event", (event: PipelineEvent) => {
      const updated = [
        { ...event, _time: new Date().toLocaleTimeString() },
        ...eventsRef.current,
      ].slice(0, 50);
      eventsRef.current = updated;
      setEvents(updated);
      // Refresh stats
      window.api.queue.stats().then(setStats);
    });

    // Refresh stats every 10 seconds
    const interval = setInterval(() => {
      window.api.queue.stats().then(setStats);
    }, 10_000);

    return () => {
      unsub();
      clearInterval(interval);
    };
  }, []);

  const handleDeliverNow = async () => {
    const result = await window.api.api.deliverNow();
    window.api.queue.stats().then(setStats);
    alert(`Доставлено: ${result.delivered}, Ошибок: ${result.failed}`);
  };

  const handleStartDelivery = () => {
    window.api.api.startDelivery();
  };

  const cards = [
    { label: "На модерации", value: stats.review ?? 0, color: "bg-yellow-50 text-yellow-700 border-yellow-200" },
    { label: "Ожидают отправки", value: stats.pending ?? 0, color: "bg-blue-50 text-blue-700 border-blue-200" },
    { label: "Доставлено", value: stats.delivered ?? 0, color: "bg-green-50 text-green-700 border-green-200" },
    { label: "Ошибки", value: (stats.failed ?? 0) + (stats.ai_failed ?? 0), color: "bg-red-50 text-red-700 border-red-200" },
  ];

  const eventIcon: Record<string, string> = {
    incoming: "📨",
    processed: "✅",
    delivered: "📤",
    skipped: "⏭️",
    error: "❌",
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">Дашборд</h2>
        <div className="flex gap-2">
          <button
            onClick={handleStartDelivery}
            className="rounded-lg bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-700"
          >
            Запустить доставку
          </button>
          <button
            onClick={handleDeliverNow}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            Доставить сейчас
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        {cards.map((card) => (
          <div
            key={card.label}
            className={`rounded-xl border p-4 ${card.color}`}
          >
            <p className="text-2xl font-bold">{card.value}</p>
            <p className="text-xs mt-1 opacity-70">{card.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="font-semibold mb-3 text-sm">Лента активности</h3>
        {events.length === 0 ? (
          <p className="text-sm text-gray-500">
            Подключите Telegram и настройте чаты для мониторинга.
          </p>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {events.map((ev, i) => (
              <div
                key={i}
                className="flex items-start gap-2 text-xs py-1 border-b border-gray-50 last:border-0"
              >
                <span>{eventIcon[ev.type] ?? "📋"}</span>
                <span className="text-gray-400 shrink-0">{(ev as any)._time}</span>
                <span className="text-gray-700">
                  {ev.type === "incoming" && (
                    <>Входящее сообщение ({ev.textLength} симв.)</>
                  )}
                  {ev.type === "processed" && (
                    <>
                      <span className="font-medium">{ev.title}</span>
                      {" — "}
                      {ev.classification === "casting" ? "кастинг" : "работа"}
                      {ev.rolesCount > 0 && ` (${ev.rolesCount} ролей)`}
                      {ev.vacanciesCount > 0 && ` (${ev.vacanciesCount} вакансий)`}
                    </>
                  )}
                  {ev.type === "delivered" && (
                    <>Доставлено: <span className="font-medium">{ev.title}</span></>
                  )}
                  {ev.type === "skipped" && (
                    <>Пропущено: {ev.reason === "duplicate" ? "дубликат" : ev.reason === "irrelevant" ? "нерелевантно" : ev.reason === "no_contacts" ? "нет контактов" : ev.reason}</>
                  )}
                  {ev.type === "error" && (
                    <span className="text-red-600">{ev.error}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
