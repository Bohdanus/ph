import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import {
  DEFAULT_FREE_COMPLETION_TIMEOUT_MS,
  freeModelProfile,
  isDisabledFreeModel,
  MAX_FREE_COMPLETION_MAX_TOKENS,
  MAX_FREE_COMPLETION_TIMEOUT_MS,
} from './free-model-policy.mjs';
import { resolveCommandShim } from './windows-command-shim.mjs';
import { terminateWindowsProcessTree } from './windows-process-tree.mjs';

export const COMPLETION_TIMEOUT_MS = DEFAULT_FREE_COMPLETION_TIMEOUT_MS;
export const MAX_KILO_OUTPUT_BYTES = 1024 * 1024;
const MAX_KILO_STDERR_BYTES = 64 * 1024;

const PROJECT_ROOT = process.cwd();
const KILO_EXTENSION_ROOTS = [
  '.vscode/extensions',
  '.vscode-insiders/extensions',
  '.vscode-oss/extensions',
  '.cursor/extensions',
  '.windsurf/extensions',
];
const KILO_RUNTIME_ENV_KEYS = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'NO_COLOR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'KILO_DB',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
];

function kiloRuntimeEnvironment(environment) {
  return Object.fromEntries(
    KILO_RUNTIME_ENV_KEYS.flatMap((key) => (typeof environment[key] === 'string' ? [[key, environment[key]]] : []))
  );
}

async function isExecutable(path, platform, accessImpl) {
  try {
    await accessImpl(path, platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveKiloCli({
  command = process.env.KILO_CLI,
  pathValue = process.env.PATH ?? '',
  home = homedir(),
  platform = process.platform,
  accessImpl = access,
  readdirImpl = readdir,
} = {}) {
  if (typeof command === 'string' && command.trim()) return command.trim();

  const executableNames = platform === 'win32' ? ['kilo.exe', 'kilo.cmd', 'kilo.bat'] : ['kilo'];
  const searchFlags = platform === 'win32' ? constants.F_OK : constants.X_OK;
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const executable of executableNames) {
      const candidate = join(directory, executable);
      try {
        await accessImpl(candidate, searchFlags);
        return candidate;
      } catch {
        // Continue through PATH and then the supported editor extension roots.
      }
    }
  }

  for (const relativeRoot of KILO_EXTENSION_ROOTS) {
    const extensionRoot = join(home, relativeRoot);
    let entries;
    try {
      entries = await readdirImpl(extensionRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    const extensions = entries
      .filter((entry) => entry.isDirectory() && /^kilocode\.kilo-code-/i.test(entry.name))
      .sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }));
    for (const extension of extensions) {
      for (const executable of executableNames) {
        const candidate = join(extensionRoot, extension.name, 'bin', executable);
        if (await isExecutable(candidate, platform, accessImpl)) return candidate;
      }
    }
  }
  return null;
}

function reportedStatus(events, stderrText = '') {
  const visit = (value) => {
    if (!value || typeof value !== 'object') return null;
    for (const [key, child] of Object.entries(value)) {
      if (/^(?:status|statuscode|httpstatus|code)$/i.test(key)) {
        const status = Number(child);
        if (Number.isInteger(status) && status >= 400 && status <= 599) return status;
      }
      const nested = visit(child);
      if (nested !== null) return nested;
    }
    return null;
  };
  for (const event of events) {
    if (event?.type === 'error') {
      const status = visit(event);
      if (status !== null) return status;
      const message = JSON.stringify(event);
      const match = message.match(/\b(?:HTTP\s*)?(401|402|429)\b/i);
      if (match) return Number(match[1]);
    }
  }
  const statusMatch = stderrText.match(/\b(?:HTTP(?:\s+status)?|status(?:\s+code)?)\s*[:=]?\s*(401|402|429)\b/i);
  return statusMatch ? Number(statusMatch[1]) : null;
}

function hasToolActivity(events) {
  return events.some(
    (event) =>
      (typeof event?.type === 'string' && /^(?:tool|function)(?:_|$)/i.test(event.type)) || event?.part?.type === 'tool'
  );
}

function skipWhitespaceAndComments(text, from) {
  let index = from;
  while (index < text.length) {
    if (/\s/.test(text[index] ?? '')) {
      index += 1;
      continue;
    }
    if (text.startsWith('/*', index)) {
      const closing = text.indexOf('*/', index + 2);
      if (closing < 0) return null;
      index = closing + 2;
      continue;
    }
    if (text.startsWith('//', index)) {
      const newline = text.indexOf('\n', index + 2);
      if (newline < 0) return text.length;
      index = newline + 1;
      continue;
    }
    break;
  }
  return index;
}

function hasKiloFunctionCallText(text) {
  for (const match of text.matchAll(/\bkilo_[A-Za-z0-9_]+/g)) {
    if (match.index === undefined) continue;
    const openParen = skipWhitespaceAndComments(text, match.index + match[0].length);
    if (openParen === null) return true;
    if (text[openParen] !== '(') continue;
    const argument = skipWhitespaceAndComments(text, openParen + 1);
    if (argument === null) return true;
    if (text[argument] === '{') return true;
  }
  return false;
}

function matchingParenthesis(text, openParen) {
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = openParen; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === '\\') {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function hasKiloFunctionCallPrefix(text) {
  const functionNames = /\bkilo_[A-Za-z0-9_]+/g;
  let match;
  while ((match = functionNames.exec(text)) !== null) {
    const openParen = skipWhitespaceAndComments(text, match.index + match[0].length);
    if (openParen === null) return true;
    if (text[openParen] !== '(') continue;
    const closeParen = matchingParenthesis(text, openParen);
    if (closeParen < 0) return true;
    functionNames.lastIndex = Math.max(functionNames.lastIndex, closeParen + 1);
  }
  return false;
}

function hasOpenSerializedToolCallPrefix(text) {
  const lower = text.toLowerCase();
  if (lower.lastIndexOf('<function=') > lower.lastIndexOf('</function')) return true;
  if (lower.lastIndexOf('<tool_call') > lower.lastIndexOf('</tool_call')) return true;
  return hasKiloFunctionCallPrefix(text);
}

function isEscapedBacktick(text, index) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

function stripInlineCodeParagraph(text) {
  const visible = text.split('');
  let index = 0;
  while (index < text.length) {
    if (text[index] !== '`' || isEscapedBacktick(text, index)) {
      index += 1;
      continue;
    }
    let openingEnd = index + 1;
    while (text[openingEnd] === '`') openingEnd += 1;
    const openingLength = openingEnd - index;
    let searchFrom = openingEnd;
    let closingStart = -1;
    let closingEnd = -1;
    while (searchFrom < text.length) {
      const candidate = text.indexOf('`', searchFrom);
      if (candidate < 0) break;
      let candidateEnd = candidate + 1;
      while (text[candidateEnd] === '`') candidateEnd += 1;
      if (candidateEnd - candidate === openingLength) {
        closingStart = candidate;
        closingEnd = candidateEnd;
        break;
      }
      searchFrom = candidateEnd;
    }
    if (closingStart < 0 || closingEnd < 0) {
      index = openingEnd;
      continue;
    }
    for (let cursor = index; cursor < closingEnd; cursor += 1) {
      if (text[cursor] !== '\n' && text[cursor] !== '\r') visible[cursor] = ' ';
    }
    index = closingEnd;
  }
  return visible.join('');
}

function stripInlineCodeSpans(text) {
  return text
    .split(/((?:\r?\n[ \t]*){2,})/)
    .map((paragraph, index) => (index % 2 === 0 ? stripInlineCodeParagraph(paragraph) : paragraph))
    .join('');
}

function expandBlockquotePrefixTabs(line) {
  let expanded = '';
  let column = 0;
  let index = 0;
  while (index < line.length) {
    const character = line[index];
    if (character === ' ' || character === '>') {
      expanded += character;
      column += 1;
      index += 1;
      continue;
    }
    if (character === '\t') {
      const spaces = 4 - (column % 4);
      expanded += ' '.repeat(spaces);
      column += spaces;
      index += 1;
      continue;
    }
    break;
  }
  return expanded + line.slice(index);
}

function parseBlockquoteLine(line) {
  let text = expandBlockquotePrefixTabs(line);
  let quoteDepth = 0;
  while (true) {
    const prefix = /^ {0,3}> ?/.exec(text);
    if (!prefix) break;
    text = text.slice(prefix[0].length);
    quoteDepth += 1;
  }
  return { quoteDepth, text };
}

function leadingIndentColumns(line) {
  let index = 0;
  let columns = 0;
  while (line[index] === ' ' || line[index] === '\t') {
    if (line[index] === '\t') {
      columns += 4 - (columns % 4);
    } else {
      columns += 1;
    }
    index += 1;
  }
  return { columns, index };
}

function parseListMarker(line) {
  const indentation = leadingIndentColumns(line);
  const marker = /^([-+*]|[0-9]{1,9}[.)])(?:([ \t]+)|$)/.exec(line.slice(indentation.index));
  if (!marker) return null;

  const markerEnd = indentation.columns + marker[1].length;
  let contentIndent = markerEnd + 1;
  if (marker[2]) {
    let paddedIndent = markerEnd;
    for (const character of marker[2]) {
      paddedIndent = character === '\t' ? paddedIndent + (4 - (paddedIndent % 4)) : paddedIndent + 1;
    }
    const padding = paddedIndent - markerEnd;
    contentIndent = markerEnd + (padding <= 4 ? padding : 1);
  }

  return { markerIndent: indentation.columns, contentIndent };
}

function updateListStack(listStacks, quoteDepth, line, canStartIndentedCode) {
  for (const depth of listStacks.keys()) {
    if (depth > quoteDepth) listStacks.delete(depth);
  }

  const stack = listStacks.get(quoteDepth) ?? [];
  const marker = parseListMarker(line);
  if (marker) {
    while (stack.length > 0 && marker.markerIndent < stack.at(-1).contentIndent) stack.pop();
    const parent = stack.at(-1);
    const startsListItem = parent ? marker.markerIndent >= parent.contentIndent : marker.markerIndent <= 3;
    if (startsListItem) {
      stack.push(marker);
      listStacks.set(quoteDepth, stack);
      return stack;
    }
  }

  if (canStartIndentedCode) {
    const indentation = leadingIndentColumns(line).columns;
    while (stack.length > 0 && indentation < stack.at(-1).contentIndent) stack.pop();
  }
  if (stack.length > 0) listStacks.set(quoteDepth, stack);
  else listStacks.delete(quoteDepth);
  return stack;
}

function isSerializedToolCallText(content) {
  const outsideFencedSegments = [];
  let currentSegment = [];
  const lines = content.split(/\r?\n/).map(parseBlockquoteLine);
  const listStacks = new Map();
  let fence = null;
  let indentedCode = null;
  let canStartIndentedCode = true;
  for (const { quoteDepth, text: line } of lines) {
    let reprocess = true;
    while (reprocess) {
      reprocess = false;
      if (fence) {
        if (quoteDepth < fence.quoteDepth) {
          fence = null;
          canStartIndentedCode = true;
          reprocess = true;
          continue;
        }
        if (
          quoteDepth === fence.quoteDepth &&
          line.trim() !== '' &&
          leadingIndentColumns(line).columns < fence.listContentIndent
        ) {
          fence = null;
          canStartIndentedCode = true;
          reprocess = true;
          continue;
        }
        if (quoteDepth === fence.quoteDepth) {
          const closing = /^([ \t]*)(`+|~+)[ \t]*$/.exec(line);
          const closingIndent = leadingIndentColumns(line).columns;
          if (
            closing &&
            closingIndent >= fence.listContentIndent &&
            closingIndent <= fence.listContentIndent + 3 &&
            closing[2][0] === fence.character &&
            closing[2].length >= fence.length
          ) {
            fence = null;
            canStartIndentedCode = true;
          }
        }
        break;
      }
      if (indentedCode) {
        if (
          quoteDepth === indentedCode.quoteDepth &&
          (line.trim() === '' || leadingIndentColumns(line).columns >= indentedCode.minimumIndent)
        ) {
          break;
        }
        indentedCode = null;
        canStartIndentedCode = true;
        reprocess = true;
        continue;
      }
      if (line.trim() === '') {
        currentSegment.push(line);
        canStartIndentedCode = true;
        break;
      }
      const listStack = updateListStack(listStacks, quoteDepth, line, canStartIndentedCode);
      const listContentIndent = listStack.at(-1)?.contentIndent ?? 0;
      const indentation = leadingIndentColumns(line).columns;
      const opening = /^([ \t]*)(`{3,}|~{3,})(.*)$/.exec(line);
      if (
        opening &&
        indentation >= listContentIndent &&
        indentation <= listContentIndent + 3 &&
        !(opening[2][0] === '`' && opening[3].includes('`'))
      ) {
        outsideFencedSegments.push(currentSegment.join('\n'));
        currentSegment = [];
        fence = {
          character: opening[2][0],
          length: opening[2].length,
          quoteDepth,
          listContentIndent,
        };
        canStartIndentedCode = true;
        break;
      }
      const minimumIndentedCodeIndent = listContentIndent + 4;
      if (indentation >= minimumIndentedCodeIndent && canStartIndentedCode) {
        const visiblePrefix = stripInlineCodeSpans(currentSegment.join('\n'));
        if (hasOpenSerializedToolCallPrefix(visiblePrefix)) return true;
        outsideFencedSegments.push(currentSegment.join('\n'));
        currentSegment = [];
        indentedCode = { quoteDepth, minimumIndent: minimumIndentedCodeIndent };
        canStartIndentedCode = false;
        break;
      }
      currentSegment.push(line);
      canStartIndentedCode = false;
    }
  }
  outsideFencedSegments.push(currentSegment.join('\n'));
  return outsideFencedSegments.some((outsideFencedText) => {
    const visibleText = stripInlineCodeSpans(outsideFencedText);
    return (
      /(?:<tool_call\s*>\s*)?<function=[A-Za-z0-9_.:-]+>[\s\S]*?<\/function\s*>(?:\s*<\/tool_call\s*>)?/i.test(
        visibleText
      ) || hasKiloFunctionCallText(visibleText)
    );
  });
}

function isExactZeroCost(cost) {
  if (typeof cost === 'number') return Number.isFinite(cost) && cost === 0;
  return typeof cost === 'string' && /^0+(?:\.0+)?$/.test(cost.trim());
}

function parseEvents(output) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').trim())
    .filter((line) => line.startsWith('{'));
  const events = [];
  let malformed = false;
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      malformed = true;
    }
  }
  return { events, malformed };
}

function sanitizedProcessError(events, stderrText, code, signal) {
  const status = reportedStatus(events, stderrText);
  if (status === 401) return { error: 'Kilo authentication was rejected', exhaustSource: true, status };
  if (status === 402 || status === 429) {
    return { error: `Kilo provider quota or rate limit returned HTTP ${status}`, exhaustSource: true, status };
  }
  if (/\bfree model usage limit reached\b/i.test(stderrText)) {
    return { error: 'Kilo provider quota or rate limit was reached', exhaustSource: true };
  }
  const modelAttributable =
    status !== null &&
    events.some((event) => {
      if (event?.type !== 'error') return false;
      const error = event.error && typeof event.error === 'object' ? event.error : event;
      const identity = [error.code, error.type, event.code].filter((value) => typeof value === 'string').join(' ');
      return /(?:^|[._-])(?:model|upstream_model)(?:[._-]|$)/i.test(identity);
    });
  if (events.some((event) => event?.type === 'error')) {
    return {
      error: 'Kilo CLI reported a provider or completion error',
      exhaustSource: false,
      status,
      modelAttributable,
    };
  }
  return {
    error: `Kilo CLI exited ${code ?? signal ?? 'without a status'}`,
    exhaustSource: false,
    status,
    modelAttributable,
  };
}

const CONTENT_POLICY_ERROR_CODES = new Set([
  'content_filter',
  'content_filter_blocked',
  'content_filter_violation',
  'content_policy',
  'content_policy_blocked',
  'content_policy_violation',
  'moderation_blocked',
  'moderation_rejected',
  'prompt_injection_detected',
  'refusal',
  'safety_filter',
  'safety_violation',
]);
const VERSIONED_CONTENT_POLICY_ERROR_CODE = /^(?:content_filter|content_policy)(?:_(?:blocked|violation))?_v\d+$/;

const CONTENT_POLICY_MESSAGE_PATTERNS = [
  /flagged as potentially violating (?:our |the )?(?:content|safety|usage) polic(?:y|ies)/i,
  /(?:content|safety) filter (?:was |has been )?(?:triggered|blocked|rejected|flagged)/i,
  /(?:content|safety|usage) policy (?:violation|blocked|rejected|flagged)/i,
  /prompt (?:injection )?patterns? detected/i,
  /(?:prompt|request|content) (?:was |is )?(?:flagged|rejected|blocked|not allowed) by (?:the )?(?:content|safety|moderation|usage) (?:filter|policy)/i,
  /(?:prompt|request|content) (?:was |is )?(?:rejected|blocked) for (?:a |the )?(?:content|safety|moderation|usage) policy violation/i,
  /moderation (?:flagged|blocked|rejected|detected)/i,
  /content failed moderation/i,
  /violates? (?:our |the )?(?:content|safety|usage) policy/i,
];

function contentPolicyRejected(events, stderrText = '') {
  const allEvents = [...events, ...parseEvents(stderrText).events];
  if (
    allEvents.some(
      (event) =>
        event?.type === 'step_finish' &&
        String(event.part?.reason ?? '')
          .toLowerCase()
          .replaceAll('_', '-') === 'content-filter'
    )
  ) {
    return true;
  }
  const errorEvents = allEvents.filter((event) => event?.type === 'error');
  for (const event of errorEvents) {
    const error = event.error && typeof event.error === 'object' ? event.error : event;
    // event.type is the JSONL discriminator; policy codes can be in error.code,
    // error.type, event.code, or string-valued event.error.
    const codes = [error.code, error.type, event.code, typeof event.error === 'string' ? event.error : null]
      .filter((value) => typeof value === 'string')
      .map((value) =>
        value
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '')
      );
    if (codes.some((code) => CONTENT_POLICY_ERROR_CODES.has(code) || VERSIONED_CONTENT_POLICY_ERROR_CODE.test(code))) {
      return true;
    }
  }
  const messages = [stderrText];
  for (const event of errorEvents) {
    const error = event.error && typeof event.error === 'object' ? event.error : event;
    messages.push(String(error.message ?? event.message ?? (typeof event.error === 'string' ? event.error : '')));
  }
  return messages.some((message) => CONTENT_POLICY_MESSAGE_PATTERNS.some((pattern) => pattern.test(message)));
}

export async function runKiloCompletion({
  command,
  source = 'kilo',
  model,
  prompt,
  maxTokens,
  timeoutMs,
  projectRoot = PROJECT_ROOT,
  env = process.env,
  spawnImpl = spawn,
  platform = process.platform,
  terminateWindowsProcessTreeImpl = terminateWindowsProcessTree,
} = {}) {
  if (source !== 'kilo') return { error: 'Unsupported Kilo CLI provider' };
  if (typeof command !== 'string' || !command.trim())
    return { error: 'Kilo CLI is not configured', exhaustSource: true };
  if (typeof model !== 'string' || !/^[A-Za-z0-9._/-]+(?::[A-Za-z0-9._-]+)?$/.test(model)) {
    return { error: 'Invalid model ID' };
  }
  if (isDisabledFreeModel(model)) {
    return { error: 'Nemotron model ID is not approved by free-model policy' };
  }
  if (typeof prompt !== 'string' || !prompt) return { error: 'Prompt is empty' };
  if (
    maxTokens !== undefined &&
    (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_FREE_COMPLETION_MAX_TOKENS)
  ) {
    return { error: 'Invalid token limit' };
  }
  if (
    timeoutMs !== undefined &&
    (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_FREE_COMPLETION_TIMEOUT_MS)
  ) {
    return { error: 'Invalid completion timeout' };
  }
  const profile = freeModelProfile(model, maxTokens);
  const effectiveTimeoutMs = timeoutMs ?? profile.timeoutMs;
  if (
    !Number.isSafeInteger(profile.maxTokens) ||
    profile.maxTokens < 1 ||
    profile.maxTokens > MAX_FREE_COMPLETION_MAX_TOKENS
  ) {
    return { error: 'Invalid token limit' };
  }
  if (!Number.isSafeInteger(effectiveTimeoutMs) || effectiveTimeoutMs < 1) {
    return { error: 'Invalid completion timeout' };
  }

  const message = `Answer the provided request directly, in plain text, using at most ${profile.maxTokens} output tokens.\n\n${prompt}`;
  try {
    const args = ['run', '--pure', '--format', 'json', '--model', `kilo/${model}`, '--agent', 'free-completion'];
    if (profile.reasoningEffort) args.push('--variant', profile.reasoningEffort);
    const commandShim = resolveCommandShim(command, args);

    const { events, stderrText, code, signal, timedOut, outputOverflow, malformed, inputError, terminationError } =
      await new Promise((resolve, reject) => {
        let child;
        try {
          child = spawnImpl(commandShim.command, commandShim.args, {
            cwd: projectRoot,
            env: kiloRuntimeEnvironment(env),
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: false,
            detached: platform !== 'win32',
            ...commandShim.spawnOptions,
          });
        } catch {
          reject(Object.assign(new Error('Kilo CLI could not be started'), { code: 'KILO_SPAWN' }));
          return;
        }

        const chunks = [];
        let stderrTail = Buffer.alloc(0);
        let outputBytes = 0;
        let timedOut = false;
        let outputOverflow = false;
        let inputError = false;
        let settled = false;
        let killTimer;
        let stopping = false;
        let killPromise = null;
        let timer;
        let childClosed = false;
        let terminationError = null;
        let terminationKillError = null;
        const cleanup = () => {
          clearTimeout(timer);
          clearTimeout(killTimer);
        };
        const finishChild = (code, signal) => {
          if (settled) return;
          settled = true;
          cleanup();
          let events = [];
          let malformed = false;
          try {
            const parsed = parseEvents(Buffer.concat(chunks).toString('utf8'));
            events = parsed.events;
            malformed = parsed.malformed;
          } catch {
            malformed = true;
          }
          resolve({
            events,
            stderrText: stderrTail.toString('utf8'),
            code,
            signal,
            timedOut,
            outputOverflow,
            inputError,
            terminationError,
            malformed,
          });
        };
        const stopChild = () => {
          if (stopping || settled) return;
          stopping = true;
          clearTimeout(timer);
          if (platform === 'win32') {
            // Avoid sending a tree-kill command to a PID after its process has exited and may be reused.
            if (childClosed || child.exitCode != null || child.signalCode != null) {
              terminationError = new Error(
                'Windows process-tree termination could not be verified after the child exited'
              );
              return;
            }
            if (!Number.isSafeInteger(child.pid) || child.pid < 1) {
              settled = true;
              cleanup();
              reject(Object.assign(new Error('Kilo process-tree termination failed'), { code: 'KILO_PROCESS_TREE' }));
              return;
            }
            killPromise = terminateWindowsProcessTreeImpl(child.pid).then(
              () => finishChild(null, 'SIGKILL'),
              (error) => {
                if (settled) return;
                terminationError = error;
                if (!childClosed && child.exitCode == null && child.signalCode == null) {
                  try {
                    child.kill('SIGKILL');
                  } catch (killError) {
                    terminationKillError = killError;
                  }
                  killTimer = setTimeout(() => {
                    if (settled) return;
                    const bufferedEvents = parseEvents(Buffer.concat(chunks).toString('utf8')).events;
                    const stderrText = stderrTail.toString('utf8');
                    const costs = [...bufferedEvents, ...parseEvents(stderrText).events].flatMap((event) =>
                      [event?.part?.cost, event?.cost, event?.error?.cost].filter((cost) => cost !== undefined)
                    );
                    const reportedCost = costs.some((cost) => !isExactZeroCost(cost));
                    const reportedContentPolicy = contentPolicyRejected(bufferedEvents, stderrText);
                    settled = true;
                    cleanup();
                    const cause = terminationKillError
                      ? new AggregateError([error, terminationKillError], 'Kilo process termination failed')
                      : error;
                    reject(
                      Object.assign(new Error('Kilo process-tree termination failed', { cause }), {
                        code: 'KILO_PROCESS_TREE',
                        reportedCost,
                        contentPolicyRejected: reportedContentPolicy,
                      })
                    );
                  }, 2_000);
                }
              }
            );
            return;
          }
          try {
            process.kill(-child.pid, 'SIGTERM');
          } catch (error) {
            if (error?.code !== 'ESRCH') terminationError = error;
          }
          killPromise = new Promise((resolveKill) => {
            killTimer = setTimeout(() => {
              try {
                process.kill(-child.pid, 'SIGKILL');
              } catch (error) {
                if (error?.code !== 'ESRCH') terminationError = error;
              }
              resolveKill();
            }, 2_000);
          });
        };
        timer = setTimeout(() => {
          timedOut = true;
          stopChild();
        }, effectiveTimeoutMs);
        child.stdout.on('data', (chunk) => {
          if (outputOverflow) return;
          const remainingBytes = MAX_KILO_OUTPUT_BYTES - outputBytes;
          outputBytes += chunk.byteLength;
          if (outputBytes > MAX_KILO_OUTPUT_BYTES) {
            if (remainingBytes > 0) chunks.push(Buffer.from(chunk.subarray(0, remainingBytes)));
            outputOverflow = true;
            stopChild();
            return;
          }
          chunks.push(chunk);
        });
        child.stderr.on('data', (chunk) => {
          const combined = Buffer.concat([stderrTail, chunk]);
          stderrTail = Buffer.from(combined.subarray(Math.max(0, combined.length - MAX_KILO_STDERR_BYTES)));
        });
        child.stdin.on('error', () => {
          inputError = true;
        });
        child.once('error', (error) => {
          if (settled) return;
          if (stopping && terminationError) {
            terminationKillError = error;
            return;
          }
          settled = true;
          cleanup();
          reject(Object.assign(new Error('Kilo CLI could not be started'), { code: 'KILO_SPAWN' }));
        });
        child.once('close', (code, signal) => {
          childClosed = true;
          if (killPromise) {
            void killPromise.then(() => finishChild(code, signal));
            return;
          }
          finishChild(code, signal);
        });
        child.stdin.end(message);
      });

    const stderrEvents = parseEvents(stderrText).events;
    const costs = [...events, ...stderrEvents].flatMap((event) =>
      [event?.part?.cost, event?.cost, event?.error?.cost].filter((cost) => cost !== undefined)
    );
    if (costs.some((cost) => !isExactZeroCost(cost))) {
      return {
        error: 'Kilo reported non-zero or invalid completion cost',
        exhaustSource: true,
        safetyStop: true,
        reportedCost: true,
      };
    }
    if (contentPolicyRejected(events, stderrText)) {
      return { error: 'Kilo provider content policy rejected or filtered this request', contentPolicyRejected: true };
    }
    if (terminationError) {
      return { error: 'Kilo process-tree termination failed', exhaustSource: true, safetyStop: true };
    }
    if (timedOut) return { error: `Kilo completion exceeded ${effectiveTimeoutMs} ms` };
    if (outputOverflow) return { error: `Kilo CLI output exceeded ${MAX_KILO_OUTPUT_BYTES} bytes` };
    if (malformed) return { error: 'Kilo CLI returned malformed JSONL output', exhaustSource: true };
    if (hasToolActivity([...events, ...stderrEvents]))
      return { error: 'Kilo attempted a tool call; the completion was rejected', exhaustSource: true };
    if (events.some((event) => event?.type === 'error')) return sanitizedProcessError(events, stderrText, code, signal);
    if (code !== 0) return sanitizedProcessError(events, stderrText, code, signal);
    if (inputError) return { error: 'Kilo CLI did not accept the complete prompt' };

    const terminal = events.filter((event) => event?.type === 'step_finish').at(-1);
    const content = events
      .filter((event) => event?.type === 'text')
      .map((event) => (typeof event?.part?.text === 'string' ? event.part.text : (event.text ?? '')))
      .join('');
    if (isSerializedToolCallText(content)) {
      return { error: 'Kilo attempted a tool call; the completion was rejected', exhaustSource: true };
    }
    if (terminal?.part?.reason !== 'stop' || !content.trim()) {
      return {
        error: 'Kilo did not return a complete non-empty response',
        ...(terminal?.part?.reason === 'length' ? { finishReason: 'length' } : {}),
      };
    }
    const tokens = terminal.part?.tokens;
    return {
      model,
      content,
      finishReason: 'stop',
      usage: tokens
        ? {
            input_tokens: tokens.input,
            output_tokens: tokens.output,
            reasoning_tokens: tokens.reasoning,
            ...(costs.length ? { cost: costs.at(-1) } : {}),
          }
        : costs.length
          ? { cost: costs.at(-1) }
          : null,
    };
  } catch (error) {
    if (error?.code === 'KILO_PROCESS_TREE') {
      return {
        error: 'Kilo process-tree termination failed',
        exhaustSource: true,
        ...(error.reportedCost ? { reportedCost: true, safetyStop: true } : {}),
        ...(error.contentPolicyRejected ? { contentPolicyRejected: true } : {}),
        ...(!error.reportedCost && !error.contentPolicyRejected ? { safetyStop: true } : {}),
      };
    }
    return {
      error: error?.code === 'KILO_SPAWN' ? 'Kilo CLI could not be started' : 'Kilo completion failed locally',
      exhaustSource: error?.code === 'KILO_SPAWN',
    };
  }
}
