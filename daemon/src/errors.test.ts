import { describe, it, expect } from "vitest";
import { formatErrorResponse } from "./errors.js";

describe("formatErrorResponse", () => {
  it("returns correct OpenAI error shape with defaults", () => {
    const result = formatErrorResponse("Something went wrong", "server_error");
    expect(result).toEqual({
      error: {
        message: "Something went wrong",
        type: "server_error",
        param: null,
        code: null,
      },
    });
  });

  it("passes through optional param and code", () => {
    const result = formatErrorResponse(
      "Bad request",
      "invalid_request_error",
      "messages",
      "invalid_type",
    );
    expect(result).toEqual({
      error: {
        message: "Bad request",
        type: "invalid_request_error",
        param: "messages",
        code: "invalid_type",
      },
    });
  });
});
