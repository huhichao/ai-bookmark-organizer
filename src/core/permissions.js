/**
 * Convert a base URL to a Chrome extension origin match pattern (port-stripped per Chrome match pattern rules).
 */
export function toOriginMatchPattern(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

/**
 * Check synchronously whether a URL's origin is already covered by granted Chrome match patterns.
 */
export function isUrlCoveredByPatterns(rawUrl, patterns = []) {
  const target = toOriginMatchPattern(rawUrl);
  if (!target) return false;
  const u = new URL(rawUrl);
  for (const pat of patterns) {
    if (pat === '<all_urls>' || pat === '*://*/*' || pat === `${u.protocol}///*` || pat === `${u.protocol}://*/*`) {
      return true;
    }
    if (pat === target) return true;
    // Wildcard subdomain support: https://*.example.com/*
    const m = pat.match(/^(https?|file|\*):\/\/\*\.([^/]+)\/\*$/);
    if (m && (m[1] === '*' || m[1] === u.protocol.slice(0, -1))) {
      const domain = m[2];
      if (u.hostname === domain || u.hostname.endsWith(`.${domain}`)) {
        return true;
      }
    }
  }
  return false;
}
