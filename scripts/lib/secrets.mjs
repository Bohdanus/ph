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
  { pattern: /\bsk-[a-zA-Z0-9_-]{12,}\b/gi, replacement: 'sk-***REDACTED***' },
  {
    pattern: /\b(?:gh[pousr]_[a-zA-Z0-9_]{12,}|github_pat_[a-zA-Z0-9_]{12,}|xox[baprs]-[a-zA-Z0-9-]{8,})\b/gi,
    replacement: '***REDACTED***',
  },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '***REDACTED***' },
  { pattern: /xn--[a-zA-Z0-9-]{10,}/gi, replacement: 'xn--***REDACTED***' },
];

const REDACTED_MARKER = '***REDACTED***';
const SECRET_ASSIGNMENT_KEY_SOURCE =
  '(?:(?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|auth(?:orization)?|bearer|client[_-]?secret|credentials?|passphrase|password|passwd|secret|signature|sigv4|token)(?:[_-][A-Za-z0-9]+)*|(?:[A-Za-z0-9]+[_-])*(?:sig|hmac|key|key[_-]?id|access[_-]?key(?:[_-]?id)?|private[_-]?key)(?:(?:[_-][A-Za-z0-9]+)|[0-9])*)';
const SECRET_ASSIGNMENT_KEY_PATTERN = new RegExp(`^(?:${SECRET_ASSIGNMENT_KEY_SOURCE})$`, 'i');
const SECRET_ASSIGNMENT_PATTERN = new RegExp(
  `(?<![\\w])(["']?(?:${SECRET_ASSIGNMENT_KEY_SOURCE})["']?\\s*[:=]\\s*)("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^\\s,;{}]+)`,
  'gi'
);
const OPAQUE_ASSIGNMENT_PATTERN =
  /(?<![\w])(["']?[^"'=\s,;{}]*[%+][^"'=\s,;{}]*["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;{}]+)/gi;
const TEXT_ASSIGNMENT_PATTERN =
  /(?<![\w])(["']?[A-Za-z0-9_%+.-]+["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;{}]+)/gi;
const SENSITIVE_URL_PATTERN = /(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>]+|\/[^\s"'<>]*[?#][^\s"'<>]*|[?#][^\s"'<>]+)/gi;
// Preserve public SigV4 fields and numeric token counts after secrets; unknown query values remain fail-closed.
const SAFE_SIGV4_QUERY_KEYS = new Set(['x-amz-algorithm', 'x-amz-date', 'x-amz-expires', 'x-amz-signedheaders']);
const SAFE_TOKEN_METADATA_KEYS = new Set(['token_count']);
const MAX_NESTED_REDACTION_DEPTH = 5;

function normalizeSecretKey(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function isSafeMetadataKey(key) {
  return SAFE_TOKEN_METADATA_KEYS.has(normalizeSecretKey(key));
}

function isSafeTokenMetadataValue(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0;
  if (typeof value !== 'string') return false;
  const unquoted = value.replace(/^["']|["']$/g, '');
  return /^\d+$/.test(unquoted);
}

function redactAssignmentTail(value) {
  const firstSeparator = value.indexOf('&');
  if (firstSeparator < 0) return '';

  return value
    .slice(firstSeparator)
    .split('&')
    .slice(1)
    .map((parameter) => {
      if (!parameter) return '';
      const separator = parameter.indexOf('=');
      if (separator < 0) return '&[REDACTED]';

      const rawKey = parameter.slice(0, separator);
      const key = decodeUrlQueryKey(rawKey.trim().replace(/^["']|["']$/g, ''));
      const rawValue = parameter.slice(separator + 1);
      if (isSafeMetadataKey(key) && isSafeTokenMetadataValue(rawValue)) return `&${parameter}`;
      return `&${rawKey}=[REDACTED]`;
    })
    .join('');
}

function assignmentKeyFromPrefix(prefix) {
  const separator = Math.max(prefix.lastIndexOf(':'), prefix.lastIndexOf('='));
  return prefix
    .slice(0, separator)
    .trim()
    .replace(/^["']|["']$/g, '');
}

function redactAssignment(match, prefix, replacementValue, depth = 0) {
  const key = assignmentKeyFromPrefix(prefix);
  const safeNumericPrefix = replacementValue.match(/^(\d+)(?=&|$)([\s\S]*)$/);
  if (isSafeMetadataKey(decodeUrlQueryKey(key)) && safeNumericPrefix) {
    return `${prefix}${safeNumericPrefix[1]}${redactTextAssignments(safeNumericPrefix[2], depth)}`;
  }

  const sensitiveKey = isSensitiveAssignmentKey(key, replacementValue);
  const sensitiveEncodedValue =
    !sensitiveKey &&
    (depth >= MAX_NESTED_REDACTION_DEPTH
      ? /%[0-9a-f]{2}/i.test(replacementValue)
      : containsSensitiveEncodedContent(replacementValue, depth));
  if (!sensitiveKey && !sensitiveEncodedValue) {
    const separator = replacementValue.indexOf('&');
    if (separator >= 0) {
      return `${prefix}${replacementValue.slice(0, separator)}${redactTextAssignments(
        replacementValue.slice(separator),
        depth
      )}`;
    }
    return match;
  }
  const quote = replacementValue.startsWith('"') || replacementValue.startsWith("'") ? replacementValue[0] : '';
  const redactedAssignment = `${prefix}${quote}[REDACTED]${quote}`;
  return quote ? redactedAssignment : `${redactedAssignment}${redactAssignmentTail(replacementValue)}`;
}

function redactTextAssignments(input, depth = 0) {
  return input
    .replace(SECRET_ASSIGNMENT_PATTERN, (match, prefix, replacementValue) =>
      redactAssignment(match, prefix, replacementValue, depth)
    )
    .replace(OPAQUE_ASSIGNMENT_PATTERN, (match, prefix, replacementValue) =>
      redactAssignment(match, prefix, replacementValue, depth)
    )
    .replace(TEXT_ASSIGNMENT_PATTERN, (match, prefix, replacementValue) =>
      redactAssignment(match, prefix, replacementValue, depth)
    );
}

function decodePercentEncoding(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    // Decode valid ASCII escapes around malformed sequences so a bad escape cannot hide a key.
    return value.replace(/%([0-9a-f]{2})/gi, (_match, byte) => String.fromCharCode(Number.parseInt(byte, 16)));
  }
}

function decodeUrlQueryKey(rawKey) {
  let key = rawKey.replace(/\+/g, ' ');
  for (let depth = 0; depth < MAX_NESTED_REDACTION_DEPTH; depth += 1) {
    const decoded = decodePercentEncoding(key).replace(/\+/g, ' ');
    if (decoded === key) break;
    key = decoded;
  }
  return key;
}

function hasFurtherPercentEncoding(value) {
  return decodePercentEncoding(value) !== value;
}

function hasMalformedPercentEncoding(value) {
  return /%(?![0-9a-f]{2})/i.test(value);
}

function containsStructuredSensitiveKey(input) {
  const propertyPattern = /"((?:\\.|[^"\\])*)"\s*:/g;
  for (const match of input.matchAll(propertyPattern)) {
    let key;
    try {
      key = JSON.parse(`"${match[1]}"`);
    } catch {
      continue;
    }
    if (isSecretKey(key)) return true;
    const decodedKey = decodeUrlQueryKey(key);
    if (isSafeMetadataKey(decodedKey)) {
      let valueStart = match.index + match[0].length;
      while (/\s/.test(input[valueStart] ?? '')) valueStart += 1;
      if (!isStructuredTokenCountValueSafe(input, valueStart)) return true;
    }
  }
  return false;
}

function isStructuredTokenCountValueSafe(input, valueStart) {
  const first = input[valueStart];
  if (!first || first === '{' || first === '[') return false;

  let rawValue;
  if (first === '"') {
    let end = valueStart + 1;
    while (end < input.length) {
      if (input[end] === '\\') {
        end += 2;
      } else if (input[end] === '"') {
        end += 1;
        break;
      } else {
        end += 1;
      }
    }
    rawValue = input.slice(valueStart, end);
  } else {
    rawValue = input.slice(valueStart).match(/^[^\s,}\]]+/)?.[0];
  }

  if (!rawValue) return false;
  try {
    return isSafeTokenMetadataValue(JSON.parse(rawValue));
  } catch {
    return false;
  }
}

function redactStructuredJsonValue(value, depth) {
  if (depth > MAX_NESTED_REDACTION_DEPTH) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redactStructuredJsonValue(item, depth + 1));
  if (value && typeof value === 'object') {
    const result = Object.create(null);
    for (const [key, item] of Object.entries(value)) {
      if (isSafeMetadataKey(decodeUrlQueryKey(key))) {
        result[key] = isSafeTokenMetadataValue(item) ? item : '[REDACTED]';
      } else if (isSecretKey(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactStructuredJsonValue(item, depth + 1);
      }
    }
    return result;
  }
  if (typeof value === 'string') return redactStringInternal(value, depth + 1);
  return value;
}

function redactStructuredJsonText(input, depth) {
  const trimmed = input.trimStart();
  if ((trimmed[0] !== '{' && trimmed[0] !== '[') || !containsStructuredSensitiveKey(input)) return null;

  let value;
  try {
    value = JSON.parse(input);
  } catch {
    return '[REDACTED]';
  }
  return JSON.stringify(redactStructuredJsonValue(value, depth));
}

function isSensitiveAssignmentKey(rawKey, rawValue = '') {
  const key = decodeUrlQueryKey(rawKey);
  const exceedsDecodeLimit = hasFurtherPercentEncoding(key);
  if (isSafeMetadataKey(key) && !exceedsDecodeLimit && isSafeTokenMetadataValue(rawValue)) return false;
  return (
    hasMalformedPercentEncoding(rawKey) ||
    exceedsDecodeLimit ||
    isSecretKey(key) ||
    SECRET_ASSIGNMENT_KEY_PATTERN.test(normalizeSecretKey(key))
  );
}

function containsSensitiveEncodedContent(value, depth) {
  if (depth >= MAX_NESTED_REDACTION_DEPTH) return hasFurtherPercentEncoding(value);

  let decoded = value;
  for (let level = 0; level < MAX_NESTED_REDACTION_DEPTH; level += 1) {
    const next = decodePercentEncoding(decoded);
    if (next === decoded) return false;
    decoded = next;
    if (redactStringInternal(decoded, depth + 1) !== decoded) return true;
  }
  return hasFurtherPercentEncoding(decoded);
}

function hasSensitiveUrlAssignment(query, depth) {
  return query.split('&').some((parameter) => {
    const separator = parameter.indexOf('=');
    if (separator < 0) return false;
    const rawKey = parameter.slice(0, separator);
    const rawValue = parameter.slice(separator + 1);
    return isSensitiveAssignmentKey(rawKey, rawValue) || containsSensitiveEncodedContent(rawValue, depth);
  });
}

function redactUrlQueryAssignments(query, redactUnknownTail = false, depth = 0) {
  const parameters = query.split('&');
  const hasSensitiveParameter = redactUnknownTail || hasSensitiveUrlAssignment(query, depth);
  let secretSeen = hasSensitiveParameter;
  let foundSecret = hasSensitiveParameter;
  const value = parameters
    .map((parameter) => {
      const separator = parameter.indexOf('=');
      if (separator < 0) return parameter;

      const rawKey = parameter.slice(0, separator);
      const key = decodeUrlQueryKey(rawKey);
      const rawValue = parameter.slice(separator + 1);
      if (isSensitiveAssignmentKey(rawKey, rawValue)) {
        secretSeen = true;
        foundSecret = true;
        return `${rawKey}=[REDACTED]`;
      }
      const safeMetadataValue = isSafeMetadataKey(key) && isSafeTokenMetadataValue(rawValue);
      if (secretSeen && !SAFE_SIGV4_QUERY_KEYS.has(key.toLowerCase()) && !safeMetadataValue) {
        return `${rawKey}=[REDACTED]`;
      }
      if (containsSensitiveEncodedContent(rawValue, depth)) {
        secretSeen = true;
        foundSecret = true;
        return `${rawKey}=[REDACTED]`;
      }
      return parameter;
    })
    .join('&');

  return { value, foundSecret };
}

function redactUrlUserInfo(url) {
  const scheme = url.match(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//i);
  if (!scheme) return { value: url, redacted: false };

  const authorityStart = scheme[0].length;
  const remainder = url.slice(authorityStart);
  const boundaryOffset = remainder.search(/[/?#]/);
  const authorityEnd = boundaryOffset < 0 ? url.length : authorityStart + boundaryOffset;
  const authority = url.slice(authorityStart, authorityEnd);
  const at = authority.lastIndexOf('@');
  if (at < 0) return { value: url, redacted: false };

  return {
    value: `${url.slice(0, authorityStart)}${REDACTED_MARKER}@${authority.slice(at + 1)}${url.slice(authorityEnd)}`,
    redacted: true,
  };
}

function protectSensitiveUrlAssignments(input, depth = 0) {
  const replacements = [];
  const value = input.replace(SENSITIVE_URL_PATTERN, (url) => {
    const userInfo = redactUrlUserInfo(url);
    const safeUrl = userInfo.value;
    const queryStart = safeUrl.indexOf('?');
    const hashStart = safeUrl.indexOf('#');
    const hasQuery = queryStart >= 0 && (hashStart < 0 || queryStart < hashStart);
    const pathEnd = hasQuery ? queryStart : hashStart < 0 ? safeUrl.length : hashStart;
    const path = safeUrl.slice(0, pathEnd);
    const redactedPath = redactTextAssignments(path, depth);
    const pathContainsSecret = userInfo.redacted || redactedPath !== path;
    const rawFragment = hashStart < 0 ? '' : safeUrl.slice(hashStart + 1);
    const fragmentPreScan = hashStart < 0 ? null : redactUrlQueryAssignments(rawFragment, pathContainsSecret, depth);
    const fragmentContainsSecret =
      fragmentPreScan !== null &&
      (fragmentPreScan.foundSecret || redactTextAssignments(fragmentPreScan.value) !== rawFragment);

    let query = '';
    let queryContainsSecret = false;
    if (hasQuery) {
      const queryEnd = hashStart < 0 ? safeUrl.length : hashStart;
      const redactedQuery = redactUrlQueryAssignments(
        safeUrl.slice(queryStart + 1, queryEnd),
        pathContainsSecret || fragmentContainsSecret,
        depth
      );
      query = redactedQuery.value;
      queryContainsSecret = redactedQuery.foundSecret;
    }

    let fragment = '';
    let fragmentChanged = false;
    if (hashStart >= 0) {
      const redactedFragmentAssignments = redactUrlQueryAssignments(
        rawFragment,
        pathContainsSecret || queryContainsSecret,
        depth
      );
      const redactedFragmentValue = redactTextAssignments(redactedFragmentAssignments.value, depth);
      fragment = `#${redactedFragmentValue}`;
      fragmentChanged = redactedFragmentAssignments.foundSecret || redactedFragmentValue !== rawFragment;
    }
    if (!pathContainsSecret && !queryContainsSecret && !fragmentChanged) return safeUrl;

    const sanitizedUrl = hasQuery ? `${redactedPath}?${query}${fragment}` : `${redactedPath}${fragment}`;
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
  return redactStringInternal(input, 0);
}

function redactStringInternal(input, depth) {
  if (typeof input !== 'string') return input;
  const structuredJson = redactStructuredJsonText(input, depth);
  if (structuredJson !== null) return structuredJson;
  if (depth > MAX_NESTED_REDACTION_DEPTH) return redactTextAssignments(input, depth);

  let result = input;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  const protectedUrls = protectSensitiveUrlAssignments(result, depth);
  result = redactTextAssignments(protectedUrls.value, depth);
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
      if (isSafeMetadataKey(decodeUrlQueryKey(key))) {
        result[key] = isSafeTokenMetadataValue(value) ? value : REDACTED_MARKER;
      } else if (isSecretKey(key)) {
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
  const decodedKey = decodeUrlQueryKey(key);
  if (isSafeMetadataKey(decodedKey) && !hasFurtherPercentEncoding(decodedKey)) return false;
  if (hasMalformedPercentEncoding(key) || hasFurtherPercentEncoding(decodedKey)) return true;
  const lowerKey = decodedKey.toLowerCase();
  const normalizedKey = normalizeSecretKey(decodedKey);
  const keyParts = new Set(normalizedKey.split('_').filter(Boolean));
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
    SECRET_ASSIGNMENT_KEY_PATTERN.test(normalizedKey)
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
