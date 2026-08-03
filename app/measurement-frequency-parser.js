function parseLocaleDecimal(value) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(',', '.');
  if (!normalized) return NaN;
  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 ? number : NaN;
}

export function parseFrequencyPair(value) {
  const raw = String(value ?? '').trim();
  const parts = raw.split(/[\/;|]+/).map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const frequency1 = parseLocaleDecimal(parts[0]);
  const frequency2 = parseLocaleDecimal(parts[1]);
  if (!(frequency1 > 0) || !(frequency2 > 0)) return null;

  return {
    frequency1,
    frequency2,
    display1: parts[0],
    display2: parts[1]
  };
}
