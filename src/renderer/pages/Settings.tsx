import { useState, useEffect } from "react";

interface Prompt {
  key: string;
  system_prompt: string;
  model_override: string | null;
  updated_at: string;
}

export default function Settings() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [saved, setSaved] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);

  useEffect(() => {
    window.api.settings.getAll().then(setSettings);
    window.api.prompts.getAll().then(setPrompts);
  }, []);

  const updateSetting = async (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    await window.api.settings.set(key, value);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const updatePrompt = async (key: string, systemPrompt: string) => {
    await window.api.prompts.set(key, systemPrompt);
    setPrompts((prev) =>
      prev.map((p) =>
        p.key === key ? { ...p, system_prompt: systemPrompt } : p
      )
    );
    setEditingPrompt(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const promptLabels: Record<string, string> = {
    relevance_check: "Проверка релевантности",
    extract_meta: "Извлечение метаданных",
    count_items: "Подсчёт ролей/вакансий",
    extract_role: "Извлечение роли",
    extract_vacancy: "Извлечение вакансии",
  };

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">Настройки</h2>
        {saved && (
          <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded">
            Сохранено
          </span>
        )}
      </div>

      {/* CastHub API */}
      <section className="mb-8">
        <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide mb-3">
          CastHub API
        </h3>
        <div className="space-y-3">
          <Field
            label="URL"
            value={settings.casthub_api_url ?? ""}
            onChange={(v) => updateSetting("casthub_api_url", v)}
            placeholder="https://app.casthub.kz"
          />
          <Field
            label="API ключ"
            value={settings.casthub_api_key ?? ""}
            onChange={(v) => updateSetting("casthub_api_key", v)}
            placeholder="Bearer token"
            type="password"
          />
        </div>
      </section>

      {/* AI Provider */}
      <section className="mb-8">
        <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide mb-3">
          ИИ-провайдер
        </h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Провайдер</label>
            <select
              value={settings.ai_provider ?? "openai"}
              onChange={(e) => updateSetting("ai_provider", e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="google">Google (Gemini)</option>
            </select>
          </div>
          <Field
            label="API ключ"
            value={settings.ai_api_key ?? ""}
            onChange={(v) => updateSetting("ai_api_key", v)}
            placeholder="sk-..."
            type="password"
          />
          <Field
            label="Модель"
            value={settings.ai_model ?? ""}
            onChange={(v) => updateSetting("ai_model", v)}
            placeholder="gpt-4o-mini"
          />
        </div>
      </section>

      {/* Automation */}
      <section className="mb-8">
        <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide mb-3">
          Автоматизация
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3">
            <div>
              <p className="text-sm font-medium">Авто-публикация</p>
              <p className="text-xs text-gray-500">
                Отправлять объявления в CastHub без ручной модерации
              </p>
            </div>
            <button
              onClick={() =>
                updateSetting(
                  "auto_publish",
                  settings.auto_publish === "true" ? "false" : "true"
                )
              }
              className={`relative h-6 w-11 rounded-full transition-colors ${
                settings.auto_publish === "true" ? "bg-blue-600" : "bg-gray-300"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform shadow ${
                  settings.auto_publish === "true" ? "translate-x-5" : ""
                }`}
              />
            </button>
          </div>
          <Field
            label="Срок действия по умолчанию (дни)"
            value={settings.default_expiration_days ?? "3"}
            onChange={(v) => updateSetting("default_expiration_days", v)}
            type="number"
          />
          <Field
            label="Кеш дедупликации (дни)"
            value={settings.dedup_cache_days ?? "7"}
            onChange={(v) => updateSetting("dedup_cache_days", v)}
            type="number"
          />
        </div>
      </section>

      {/* Prompts */}
      <section>
        <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide mb-3">
          Промпты ИИ
        </h3>
        <div className="space-y-2">
          {prompts.map((prompt) => (
            <div
              key={prompt.key}
              className="rounded-lg border border-gray-200 bg-white"
            >
              <div
                className="flex items-center justify-between p-3 cursor-pointer"
                onClick={() =>
                  setEditingPrompt(
                    editingPrompt === prompt.key ? null : prompt.key
                  )
                }
              >
                <p className="text-sm font-medium">
                  {promptLabels[prompt.key] ?? prompt.key}
                </p>
                <span className="text-xs text-gray-400">
                  {editingPrompt === prompt.key ? "▲" : "▼"}
                </span>
              </div>
              {editingPrompt === prompt.key && (
                <div className="border-t border-gray-200 p-3">
                  <textarea
                    value={prompt.system_prompt}
                    onChange={(e) =>
                      setPrompts((prev) =>
                        prev.map((p) =>
                          p.key === prompt.key
                            ? { ...p, system_prompt: e.target.value }
                            : p
                        )
                      )
                    }
                    rows={8}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-xs font-mono"
                  />
                  <button
                    onClick={() =>
                      updatePrompt(prompt.key, prompt.system_prompt)
                    }
                    className="mt-2 rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
                  >
                    Сохранить
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
    </div>
  );
}
