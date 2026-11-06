/**
 * Structured JSON-lines logger.
 *
 * Every operational event is emitted as one JSON object per line with a stable
 * shape ({ time, level, component, msg, ...fields }) so log aggregators can
 * parse HELIX output without regexes. Values whose keys look sensitive
 * (tokens, passwords, API keys, authorization headers) are redacted before
 * serialization — secrets must never reach the log stream.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEY = /token|secret|password|authorization|api[-_]?key|cookie|session/i;

export function redact(fields) {
  const safe = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (SENSITIVE_KEY.test(key)) {
      safe[key] = "[redacted]";
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      safe[key] = redact(value);
      continue;
    }
    if (Array.isArray(value)) {
      safe[key] = value.map((item) =>
        item && typeof item === "object" && !Array.isArray(item) ? redact(item) : item,
      );
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

export function createLogger({ component = "helix", level = "info", sink = null } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const write = sink ? (line) => sink.write(`${line}\n`) : (line) => console.log(line);

  function emit(levelName, msg, fields) {
    if (LEVELS[levelName] < threshold) return;
    let line;
    try {
      line = JSON.stringify({
        time: new Date().toISOString(),
        level: levelName,
        component,
        msg,
        ...redact(fields),
      });
    } catch {
      line = JSON.stringify({
        time: new Date().toISOString(),
        level: levelName,
        component,
        msg: String(msg),
      });
    }
    write(line);
  }

  return {
    level,
    component,
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    child: (extra = {}) =>
      createLogger({ component: `${component}:${extra.component ?? "child"}`, level, sink }),
  };
}
