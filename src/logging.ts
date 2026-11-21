// An allowlist of operational fields: never pass request bodies, URLs, headers or errors.
export interface LogEntry {
  event:
    | "http_request"
    | "request_failed"
    | "listening"
    | "shutdown_failed"
    | "database_error"
    | "session_error";
  level: "info" | "error";
  requestId?: string;
  category?: "auth" | "admin" | "shareholder" | "public";
  method?: string;
  status?: number;
  durationMs?: number;
  port?: number;
}
export type LogSink = (line: string) => void;
export function createLogger(
  sink: LogSink = (line) => process.stdout.write(line + "\n"),
) {
  return (entry: LogEntry): void => {
    const {
      event,
      level,
      requestId,
      category,
      method,
      status,
      durationMs,
      port,
    } = entry;
    // Explicit destructuring also excludes extra runtime properties supplied by mistake.
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      level,
      requestId,
      category,
      method,
      status,
      durationMs,
      port,
    });
    try {
      sink(line);
    } catch {
      /* Logging must not turn a completed transaction into an HTTP failure. */
    }
  };
}
export const log = createLogger();
