import { describe, expect, it } from "vitest";
import { createLogger } from "../src/logging.js";
describe("structured operational logging", () => {
  it("serializes only allowlisted fields even when an object contains secrets", () => {
    const lines: string[] = [];
    const log = createLogger((line) => {
      lines.push(line);
    });
    const entry = {
      event: "http_request" as const,
      level: "info" as const,
      status: 403,
      requestId: "correlation-id",
      password: "SECRET",
      cookie: "SECRET",
      url: "/?token=SECRET",
      body: { csv: "PRIVATE CSV" },
      error: new Error("PRIVATE ERROR"),
    };
    log(entry);
    expect(JSON.parse(lines[0])).toMatchObject({
      event: "http_request",
      status: 403,
      requestId: "correlation-id",
    });
    expect(lines.join("")).not.toMatch(
      /SECRET|PRIVATE|password|cookie|url|body|error/,
    );
    expect(new Date(JSON.parse(lines[0]).timestamp).getTime()).toBeGreaterThan(
      0,
    );
  });
  it("cannot break transaction delivery when its destination fails", () => {
    expect(() =>
      createLogger(() => {
        throw new Error("offline log destination");
      })({
        event: "request_failed",
        level: "error",
        requestId: "test",
      }),
    ).not.toThrow();
  });
});
