import { useState, useEffect } from "react";

interface Prompt {
  key: string;
  system_prompt: string;
  model_override: string | null;
  updated_at: string;
}

interface DictStatus {
  loaded: boolean;
  lastUpdate: string | null;
  error: string | null;
  counts: Record<string, number> | null;
}

const STEP_KEYS: { key: string; label: string }[] = [
  { key: "relevance", label: "Релевантность" },
  { key: "meta", label: "Метаданные" },
  { key: "count", label: "Подсчёт ролей/вакансий" },
  { key: "role", label: "Извлечение роли" },
  { key: "vacancy", label: "Извлечение вакансии" },
];

export default function Settings() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [dictStatus, setDictStatus] = useState<DictStatus | null>(null);
  const [reloadingDict, setReloadingDict] = useState(false);

  useEffect(() => {
    window.api.settings.getAll().then((s) => {
      setSettings(s);
      setDraft(s);
    });
    window.api.prompts.getAll().then(setPrompts);
    window.api.dictionaries.getStatus().then(setDictStatus);

    const unsub = window.api.on("dictionaries:status", (status: DictStatus) => {
      setDictStatus(status);
    });
    return unsub;
  }, []);

  const reloadDictionaries = async () => {
    setReloadingDict(true);
    try {
      await window.api.dictionaries.reload();
      const fresh = await window.api.dictionaries.getStatus();
      setDictStatus(fresh);
    } finally {
      setReloadingDict(false);
    }
  };

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
    count_roles: "Подсчёт ролей (casting)",
    count_vacancies: "Подсчёт вакансий (technical)",
    extract_role_basic: "Роль · базовая инфо (имя, пол, возраст, описание, оплата)",
    extract_role_appearance: "Роль · внешность (тип, телосложение, волосы, глаза, лицо)",
    extract_role_skills: "Роль · навыки (языки, актёрское образование)",
    extract_role_measurements: "Роль · измерения (рост, вес, объёмы)",
    extract_vacancy: "Извлечение вакансии",
  };

  // extract_role is the legacy single-prompt version, kept in DB for rollback
  // but not used by the pipeline since the role extraction was split into 4
  // sub-calls. Hide it from the UI to avoid confusion.
  const visiblePrompts = prompts.filter((p) => p.key !== "extract_role");

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
            label="Модель (по умолчанию)"
            value={draft.ai_model ?? ""}
            onChange={(v) => updateDraft("ai_model", v)}
            placeholder="gpt-4o-mini"
          />
        </div>

        {/* Per-step overrides */}
        <details className="mt-4 rounded-lg border border-gray-200 bg-white">
          <summary className="cursor-pointer p-3 text-sm font-medium">
            Настройки по шагам (опционально)
          </summary>
          <div className="border-t border-gray-200 p-3 space-y-3">
            <p className="text-[11px] text-gray-500">
              Пусто = используется модель по умолчанию и temperature 0.1.
            </p>
            {STEP_KEYS.map((step) => (
              <div
                key={step.key}
                className="grid grid-cols-[1fr_2fr_1fr] gap-2 items-center"
              >
                <span className="text-xs text-gray-600">{step.label}</span>
                <input
                  type="text"
                  value={draft[`ai_model_${step.key}`] ?? ""}
                  onChange={(e) =>
                    updateDraft(`ai_model_${step.key}`, e.target.value)
                  }
                  placeholder="модель"
                  className="rounded border border-gray-300 px-2 py-1 text-xs"
                />
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={draft[`ai_temp_${step.key}`] ?? ""}
                  onChange={(e) =>
                    updateDraft(`ai_temp_${step.key}`, e.target.value)
                  }
                  placeholder="temp"
                  className="rounded border border-gray-300 px-2 py-1 text-xs"
                />
              </div>
            ))}
          </div>
        </details>
      </section>

      {/* Dictionaries status */}
      <section className="mb-8">
        <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide mb-3">
          Справочники CastHub
        </h3>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          {dictStatus?.loaded ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">
                  <span className="text-green-600">✓</span> Загружены
                  {dictStatus.lastUpdate && (
                    <span className="text-xs text-gray-400">
                      {" "}
                      · {new Date(dictStatus.lastUpdate).toLocaleString("ru")}
                    </span>
                  )}
                </p>
                {dictStatus.counts && (
                  <p className="text-[11px] text-gray-500 mt-1">
                    Городов: {dictStatus.counts.cities}, профессий:{" "}
                    {dictStatus.counts.professions}, цвет волос:{" "}
                    {dictStatus.counts.hairColors}, цвет глаз:{" "}
                    {dictStatus.counts.eyeColors}, телосложение:{" "}
                    {dictStatus.counts.bodyTypes}
                  </p>
                )}
              </div>
              <button
                onClick={reloadDictionaries}
                disabled={reloadingDict}
                className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
              >
                {reloadingDict ? "..." : "Обновить"}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-red-700">
                <span>✗</span> Не загружены
              </p>
              {dictStatus?.error && (
                <p className="text-[11px] text-red-600 break-all">
                  {dictStatus.error}
                </p>
              )}
              <button
                onClick={reloadDictionaries}
                disabled={reloadingDict}
                className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {reloadingDict ? "Загрузка..." : "Попробовать снова"}
              </button>
            </div>
          )}
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
          {visiblePrompts.map((prompt) => (
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
                  <p className="mb-1 text-[10px] text-gray-500 leading-relaxed">
                    Доступные токены: <code>{"{nowDate}"}</code> — сегодняшняя дата (YYYY-MM-DD),
                    универсально для всех промптов. Также: <code>{"{roleName}"}</code> (role-промпты),
                    <code>{"{professionsList}"}</code> (extract_vacancy),
                    <code>{"{appearanceTypesList}"}</code>, <code>{"{bodyTypesList}"}</code>,
                    <code>{"{hairColorsList}"}</code>, <code>{"{hairTypesList}"}</code>,
                    <code>{"{eyeColorsList}"}</code>, <code>{"{faceTypesList}"}</code>,
                    <code>{"{languagesList}"}</code>, <code>{"{actingEducationList}"}</code>.
                  </p>
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
