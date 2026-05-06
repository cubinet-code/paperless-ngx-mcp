import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { withErrorHandling } from "./middlewares";

describe("withErrorHandling", () => {
  test("preserves Error instances (keeps stack trace)", async () => {
    const originalError = new Error("something broke");
    const handler = withErrorHandling(async () => {
      throw originalError;
    });

    await assert.rejects(
      async () => handler({} as any, {} as any),
      (err: Error) => {
        // Should be the exact same Error instance, not a new wrapper
        assert.equal(err, originalError);
        assert.equal(err.message, "something broke");
        return true;
      }
    );
  });

  test("wraps non-Error throws into Error objects", async () => {
    const handler = withErrorHandling(async () => {
      throw "string error";
    });

    await assert.rejects(
      async () => handler({} as any, {} as any),
      (err: Error) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, "string error");
        return true;
      }
    );
  });
});
