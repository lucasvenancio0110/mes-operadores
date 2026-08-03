let settingsReadyPromise = null;

const DEFAULT_SETTINGS = Object.freeze({
  barLengthMm: 3600,
  kerfMm: 1
});

function numberOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

async function initializeSettings(env) {
  if (!env.DB) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
}

export async function ensureSettings(env) {
  if (!env.DB) return;
  if (!settingsReadyPromise) {
    settingsReadyPromise = initializeSettings(env).catch(error => {
      settingsReadyPromise = null;
      throw error;
    });
  }
  await settingsReadyPromise;
}

export async function getAppSettings(env) {
  await ensureSettings(env);
  if (!env.DB) return { ...DEFAULT_SETTINGS };

  const result = await env.DB.prepare(`SELECT setting_key, setting_value
    FROM app_settings
    WHERE setting_key IN ('barLengthMm', 'kerfMm')`).all();

  const settings = { ...DEFAULT_SETTINGS };
  for (const row of result.results || []) {
    if (row.setting_key === 'barLengthMm') settings.barLengthMm = numberOrDefault(row.setting_value, DEFAULT_SETTINGS.barLengthMm);
    if (row.setting_key === 'kerfMm') settings.kerfMm = numberOrDefault(row.setting_value, DEFAULT_SETTINGS.kerfMm);
  }
  return settings;
}

export async function saveAppSettings(env, payload = {}) {
  await ensureSettings(env);
  const settings = {
    barLengthMm: numberOrDefault(payload.barLengthMm, DEFAULT_SETTINGS.barLengthMm),
    kerfMm: numberOrDefault(payload.kerfMm, DEFAULT_SETTINGS.kerfMm)
  };
  if (!env.DB) return settings;

  const now = new Date().toISOString();
  await env.DB.batch(Object.entries(settings).map(([key, value]) =>
    env.DB.prepare(`INSERT INTO app_settings (setting_key, setting_value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(setting_key) DO UPDATE SET
        setting_value = excluded.setting_value,
        updated_at = excluded.updated_at`)
      .bind(key, String(value), now)
  ));

  return settings;
}
