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

function redactString(input) {
  if (typeof input !== 'string') return input;
  let result = input;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
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
  return (
    lowerKey.includes('apikey') ||
    lowerKey.includes('api_key') ||
    lowerKey.includes('access_token') ||
    lowerKey.includes('accesstoken') ||
    lowerKey.includes('authorization') ||
    lowerKey.includes('auth') ||
    lowerKey.includes('credential') ||
    lowerKey.includes('password') ||
    lowerKey.includes('secret') ||
    lowerKey.includes('signature') ||
    lowerKey.includes('sig') ||
    lowerKey === 'token' ||
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

export { REDACTED_MARKER, isSecretKey, redactString, redactObject };
