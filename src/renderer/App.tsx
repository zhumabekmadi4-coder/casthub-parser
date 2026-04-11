import { useState, useEffect } from "react";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import Queue from "./pages/Queue";
import ChatManager from "./pages/ChatManager";
import Logs from "./pages/Logs";

type Page = "dashboard" | "chats" | "queue" | "logs" | "settings";

const navItems: { id: Page; label: string; icon: string }[] = [
  { id: "dashboard", label: "Дашборд", icon: "📊" },
  { id: "chats", label: "Чаты", icon: "💬" },
  { id: "queue", label: "Очередь", icon: "📋" },
  { id: "logs", label: "Логи", icon: "📜" },
  { id: "settings", label: "Настройки", icon: "⚙️" },
];

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [tgState, setTgState] = useState("idle");
  const [apiOk, setApiOk] = useState<boolean | null>(null);

  useEffect(() => {
    // Check TDLib auth state and auto-connect if credentials saved
    window.api.tdlib.getAuthState().then((state) => {
      setTgState(state);
      if (state === "idle") {
        window.api.settings.getAll().then((s) => {
          if (s.tdlib_api_id && s.tdlib_api_hash) {
            window.api.tdlib.connect(parseInt(s.tdlib_api_id), s.tdlib_api_hash);
          }
        });
      }
    });

    // Check API connection
    window.api.api.testConnection().then((r) => setApiOk(r.ok));

    // Listen for auth state changes
    const unsub = window.api.on("tdlib:auth-state", (state: string) => {
      setTgState(state);
    });

    return unsub;
  }, []);

  const tgColor =
    tgState === "ready"
      ? "bg-green-500"
      : tgState === "idle" || tgState === "error"
        ? "bg-gray-300"
        : "bg-yellow-400";

  const apiColor =
    apiOk === true ? "bg-green-500" : apiOk === false ? "bg-red-400" : "bg-gray-300";

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <nav className="w-56 shrink-0 border-r border-gray-200 bg-white flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-lg font-bold text-gray-900">CastHub Parser</h1>
          <p className="text-xs text-gray-500 mt-0.5">Telegram агрегатор</p>
        </div>

        <div className="flex-1 p-2 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                page === item.id
                  ? "bg-blue-50 text-blue-700 font-medium"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              <span className="mr-2">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>

        {/* Connection status */}
        <div className="p-3 border-t border-gray-200 text-xs text-gray-500 space-y-1">
          <div className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${tgColor}`} />
            Telegram: {tgState === "ready" ? "подключён" : tgState === "idle" ? "не подключён" : tgState}
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${apiColor}`} />
            CastHub API: {apiOk === true ? "подключён" : apiOk === false ? "ошибка" : "не настроен"}
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-gray-50">
        {page === "dashboard" && <Dashboard />}
        {page === "chats" && <ChatManager />}
        {page === "queue" && <Queue />}
        {page === "logs" && <Logs />}
        {page === "settings" && <Settings />}
      </main>
    </div>
  );
}
