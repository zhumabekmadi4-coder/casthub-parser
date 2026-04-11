import { useState, useEffect } from "react";

interface Prompt {
  key: string;
  system_prompt: string;
  model_override: string | null;
  updated_at: string;
}

export default function Settings() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);

  useEffect(() => {
    window.api.settings.getAll().then((s) => {
      setSettings(s);
      setDraft(s);
    });
    window.api.prompts.getAll().then(setPrompts);
  }, []);

  const updateDraft = (key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    for (const [key, value] of Object.entries(draft)) {
      if (value !== settings[key]) {
        await window.api.settings.set(key, value);
      }
    }
    // Reset AI provider if it changed
    if (
      draft.ai_provider !== settings.ai_provider ||
      draft.ai_api_key !== settings.ai_api_key ||
      draft.ai_model !== settings.ai_model
    ) {
      await window.api.pipeline.resetProvider();
    }
    setSettings({ ...draft });
    setDirty(false);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleRestart = async () => {
    if (dirty) {
      await handleSave();
    }
    window.api.app.restart();
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
    setTimeout(() => setSaved(false), 3000);
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
        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded">
              Сохранено
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              dirty
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}
          >
            {saving ? "Сохранение..." : "Сохранить"}
          </button>
          <button
            onClick={handleRestart}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Перезапустить
          </button>
        </div>
      </div>

      {dirty && (
        <div className="mb-4 rounded-lg bg-yellow-50 border border-yellow-200 px-3 py-2 text-xs text-yellow-700">
          Есть несохранённые изменения
        </div>
      )}

      {/* CastHub API */}
      <section className="mb-8">
        <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide mb-3">
          CastHub API
        </h3>
        <div className="space-y-3">
          <Field
            label="URL"
            value={draft.casthub_api_url ?? ""}
            onChange={(v) => updateDraft("casthub_api_url", v)}
            placeholder="https://app.casthub.kz"
          />
          <Field
            label="API ключ"
            value={draft.casthub_api_key ?? ""}
            onChange={(v) => updateDraft("casthub_api_key", v)}
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
              value={draft.ai_provider ?? "openai"}
              onChange={(e) => updateDraft("ai_provider", e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="google">Google (Gemini)</option>
            </select>
          </div>
          <Field
            label="API ключ"
            value={draft.ai_api_key ?? ""}
            onChange={(v) => updateDraft("ai_api_key", v)}
            placeholder="sk-..."
            type="password"
          />
          <Field
            label="Модель"
            value={draft.ai_model ?? ""}
            onChange={(v) => updateDraft("ai_model", v)}
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
                updateDraft(
                  "auto_publish",
                  draft.auto_publish === "true" ? "false" : "true"
                )
              }
              className={`relative h-6 w-11 rounded-full transition-colors ${
                draft.auto_publish === "true" ? "bg-blue-600" : "bg-gray-300"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform shadow ${
                  draft.auto_publish === "true" ? "translate-x-5" : ""
                }`}
              />
            </button>
          </div>
          <Field
            label="Срок действия по умолчанию (дни)"
            value={draft.default_expiration_days ?? "3"}
            onChange={(v) => updateDraft("default_expiration_days", v)}
            type="number"
          />
          <Field
            label="Кеш дедупликации (дни)"
            value={draft.dedup_cache_days ?? "7"}
            onChange={(v) => updateDraft("dedup_cache_days", v)}
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
                    Сохранить промпт
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
