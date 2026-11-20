const ZERO_WIDTH_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

/**
 * Strip invisible zero-width formatting characters from bookmark titles.
 */
export function cleanBookmarkTitle(title) {
  return String(title || '').replace(ZERO_WIDTH_RE, '').trim();
}

/**
 * Sanitize URL before sending to external LLM APIs.
 * By default strips query string & hash to avoid leaking tokens/emails/session IDs.
 */
export function sanitizeUrlForAi(rawUrl, stripQueryParams = true) {
  try {
    const parsed = new URL(rawUrl);
    if (!stripQueryParams) {
      return `${parsed.origin}${parsed.pathname}${parsed.search}`;
    }
    const cleanPath = parsed.pathname.length > 80
      ? `${parsed.pathname.slice(0, 80)}...`
      : parsed.pathname;
    return `${parsed.origin}${cleanPath}`;
  } catch {
    return String(rawUrl || '').slice(0, 120);
  }
}

/**
 * Build compact, privacy-safe items for AI categorization.
 */
export function buildAiPayloadItems(items, { stripQueryParams = true } = {}) {
  return items.map((item) => ({
    id: item.id,
    title: cleanBookmarkTitle(item.title) || '(无标题)',
    url: sanitizeUrlForAi(item.url, stripQueryParams),
    addedAt: item.dateAdded ? new Date(item.dateAdded).toISOString().slice(0, 10) : '',
    folderHint: item.parentPath || '',
  }));
}
