#!/usr/bin/env node

const SECRET_PATTERNS = [
  {
    pattern: /(?:openrouter[_-]?api[_-]?key|OPENROUTER_API_KEY)\s*[=:]\s*([a-zA-Z0-9_-]{20,})/gi,
    replacement: 'OPENROUTER_API_KEY=***REDACTED***',
  },
  {
    pattern: /(?:groq[_-]?api[_-]?key|GROQ_API_KEY)\s*[=:]\s*([a-zA-Z0-9_-]{20,})/gi,
    replacement: 'GROQ_API_KEY=***REDACTED***',
  },
  {
    pattern: /(?:groq[_-]?api[_-]?keys|GROQ_API_KEYS)\s*[=:]\s*([a-zA-Z0-9_,-]{20,})/gi,
    replacement: 'GROQ_API_KEYS=***REDACTED***',
  },
  { pattern: /(?:kilo[_-]?cli|KILO_CLI)\s*[=:]\s*([^\s]{10,})/gi, replacement: 'KILO_CLI=***REDACTED***' },
  { pattern: /Bearer\s+([a-zA-Z0-9_-]{20,})/gi, replacement: 'Bearer ***REDACTED***' },
  { pattern: /Authorization:\s*Bearer\s+([a-zA-Z0-9_-]{20,})/gi, replacement: 'Authorization: Bearer ***REDACTED***' },
  { pattern: /sk-[a-zA-Z0-9]{20,}/gi, replacement: 'sk-***REDACTED***' },
  { pattern: /sk-[a-zA-Z0-9]{32,}/gi, replacement: 'sk-***REDACTED***' },
  { pattern: /xn--[a-zA-Z0-9-]{10,}/gi, replacement: 'xn--***REDACTED***' },
];

const REDACTED_MARKER = '***REDACTED***';
const SECRET_ASSIGNMENT_KEY_PATTERN =
  /^(?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|auth(?:orization)?|bearer|client[_-]?secret|credentials?|password|passwd|secret|signature|sigv4|token)(?:[_-][A-Za-z0-9]+)*$/i;
const SECRET_ASSIGNMENT_PATTERN =
  /(?<![\w])(["']?(?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|auth(?:orization)?|bearer|client[_-]?secret|credentials?|password|passwd|secret|signature|sigv4|token)(?:[_-][A-Za-z0-9]+)*["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;{}]+)/gi;
const SENSITIVE_URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/gi;
const SAFE_SIGV4_QUERY_KEYS = new Set(['x-amz-algorithm', 'x-amz-date', 'x-amz-expires', 'x-amz-signedheaders']);

function redactTextAssignments(input) {
  return input.replace(SECRET_ASSIGNMENT_PATTERN, (_match, prefix, replacementValue) => {
    const quote = replacementValue.startsWith('"') || replacementValue.startsWith("'") ? replacementValue[0] : '';
    return `${prefix}${quote}[REDACTED]${quote}`;
  });
}

function isSensitiveAssignmentKey(rawKey) {
  let key = rawKey;
  try {
    key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
  } catch {
    // Keep the raw key when it is not valid percent-encoding.
  }
  return isSecretKey(key) || SECRET_ASSIGNMENT_KEY_PATTERN.test(key);
}

function redactUrlQueryAssignments(query, redactUnknownTail = false) {
  let secretSeen = redactUnknownTail;
  let foundSecret = redactUnknownTail;
  const value = query
    .split('&')
    .map((parameter) => {
      const separator = parameter.indexOf('=');
      if (separator < 0) return parameter;

      const rawKey = parameter.slice(0, separator);
      const key = (() => {
        try {
          return decodeURIComponent(rawKey.replace(/\+/g, ' '));
        } catch {
          return rawKey;
        }
      })();
      if (isSensitiveAssignmentKey(rawKey)) {
        secretSeen = true;
        foundSecret = true;
        return `${rawKey}=[REDACTED]`;
      }
      if (secretSeen && !SAFE_SIGV4_QUERY_KEYS.has(key.toLowerCase())) {
        return `${rawKey}=[REDACTED]`;
      }
      return parameter;
    })
    .join('&');

  return { value, foundSecret };
}

function protectSensitiveUrlAssignments(input) {
  const replacements = [];
  const value = input.replace(SENSITIVE_URL_PATTERN, (url) => {
    const queryStart = url.indexOf('?');
    const hashStart = url.indexOf('#');
    const hasQuery = queryStart >= 0 && (hashStart < 0 || queryStart < hashStart);
    const pathEnd = hasQuery ? queryStart : hashStart < 0 ? url.length : hashStart;
    const path = url.slice(0, pathEnd);
    const redactedPath = redactTextAssignments(path);
    const pathContainsSecret = redactedPath !== path;

    let query = '';
    let queryContainsSecret = false;
    if (hasQuery) {
      const queryEnd = hashStart < 0 ? url.length : hashStart;
      const redactedQuery = redactUrlQueryAssignments(url.slice(queryStart + 1, queryEnd), pathContainsSecret);
      query = redactedQuery.value;
      queryContainsSecret = redactedQuery.foundSecret;
    }

    const fragment = hashStart < 0 ? '' : url.slice(hashStart);
    const redactedFragment = redactTextAssignments(fragment);
    const fragmentContainsSecret = redactedFragment !== fragment;
    if (!pathContainsSecret && !queryContainsSecret && !fragmentContainsSecret) return url;

    const sanitizedUrl = hasQuery
      ? `${redactedPath}?${query}${redactedFragment}`
      : `${redactedPath}${redactedFragment}`;
    let markerIndex = replacements.length;
    let marker = `__PH_SANITIZED_URL_${markerIndex}__`;
    while (input.includes(marker) || replacements.some((replacement) => replacement.marker === marker)) {
      markerIndex += 1;
      marker = `__PH_SANITIZED_URL_${markerIndex}__`;
    }
    replacements.push({ marker, url: sanitizedUrl });
    return marker;
  });

  return { value, replacements };
}

function redactString(input) {
  if (typeof input !== 'string') return input;
  let result = input;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  const protectedUrls = protectSensitiveUrlAssignments(result);
  result = redactTextAssignments(protectedUrls.value);
  for (const { marker, url } of protectedUrls.replacements) {
    result = result.replace(marker, () => url);
  }
  return result;
}

function redactObject(obj, depth = 0) {
  if (depth > 10) return '[Object: max depth exceeded]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return redactString(obj);
  if (typeof obj === 'number' || typeof obj === 'boolean') return obj;
  if (Array.isArray(obj)) return obj.map((item) => redactObject(item, depth + 1));
  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (isSecretKey(key)) {
        result[key] = REDACTED_MARKER;
      } else {
        result[key] = redactObject(value, depth + 1);
      }
    }
    return result;
  }
  return obj;
}

function isSecretKey(key) {
  const lowerKey = key.toLowerCase();
  const normalizedKey = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  const keyParts = new Set(normalizedKey.split(/[^a-z0-9]+/).filter(Boolean));
  return (
    lowerKey.includes('apikey') ||
    lowerKey.includes('api_key') ||
    lowerKey.includes('access_token') ||
    lowerKey.includes('accesstoken') ||
    lowerKey.includes('authorization') ||
    keyParts.has('auth') ||
    keyParts.has('authentication') ||
    keyParts.has('authtoken') ||
    lowerKey.includes('credential') ||
    lowerKey.includes('password') ||
    lowerKey.includes('secret') ||
    lowerKey.includes('signature') ||
    keyParts.has('sig') ||
    keyParts.has('sigv4') ||
    keyParts.has('token') ||
    lowerKey === 'key' ||
    lowerKey === 'hmac' ||
    lowerKey === 'keyid' ||
    lowerKey === 'apikey' ||
    lowerKey === 'accesskey' ||
    lowerKey === 'accesskeyid'
  );
}

export function sanitizeForLogging(input) {
  if (typeof input === 'string') {
    return redactString(input);
  }
  if (input && typeof input === 'object') {
    return redactObject(input);
  }
  return input;
}

export function sanitizeErrorMessage(message) {
  if (!message || typeof message !== 'string') return message;
  return redactString(message);
}

export function sanitizeErrorStack(stack) {
  if (!stack || typeof stack !== 'string') return stack;
  return redactString(stack);
}

export function sanitizeForOutput(data) {
  return sanitizeForLogging(data);
}

export function redactSensitiveText(value) {
  if (typeof value !== 'string') return value;
  return sanitizeForOutput(
    value
      .replace(/\b(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED]')
      .replace(
        /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{8,})\b/g,
        '[REDACTED]'
      )
      .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]')
  );
}

export { REDACTED_MARKER, isSecretKey, redactString, redactObject };
