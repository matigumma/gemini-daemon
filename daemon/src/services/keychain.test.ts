import { describe, it, expect, vi, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { readKeychain, writeKeychain, deleteKeychain } from "./keychain.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);

const sampleTokens = {
  access_token: "ya29.test",
  refresh_token: "1//test-refresh",
  expiry_date: 1700000000000,
  token_type: "Bearer",
  scope: "openid",
};

describe("readKeychain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("decodes base64 from security CLI output", () => {
    const b64 = Buffer.from(JSON.stringify(sampleTokens)).toString("base64");
    mockExecSync.mockReturnValue(b64 as any);

    const result = readKeychain();
    expect(result).toEqual(sampleTokens);
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining("find-generic-password"),
      expect.objectContaining({ encoding: "utf-8" }),
    );
  });

  it("returns null on command failure", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("security: SecKeychainSearchCopyNext");
    });

    expect(readKeychain()).toBeNull();
  });
});

describe("writeKeychain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delete-then-add with base64 payload", () => {
    mockExecSync.mockReturnValue("" as any);

    writeKeychain(sampleTokens);

    expect(mockExecSync).toHaveBeenCalledTimes(2);
    // First call: delete
    expect(mockExecSync.mock.calls[0][0]).toContain("delete-generic-password");
    // Second call: add with base64
    const addCmd = mockExecSync.mock.calls[1][0] as string;
    expect(addCmd).toContain("add-generic-password");
    const b64 = Buffer.from(JSON.stringify(sampleTokens)).toString("base64");
    expect(addCmd).toContain(b64);
  });

  it("handles delete failure (item didn't exist)", () => {
    mockExecSync
      .mockImplementationOnce(() => {
        throw new Error("exit code 44");
      })
      .mockReturnValueOnce("" as any);

    // Should not throw
    expect(() => writeKeychain(sampleTokens)).not.toThrow();
    expect(mockExecSync).toHaveBeenCalledTimes(2);
  });
});

describe("deleteKeychain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls delete command", () => {
    mockExecSync.mockReturnValue("" as any);
    deleteKeychain();
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining("delete-generic-password"),
      expect.any(Object),
    );
  });

  it("ignores error code 44", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("exit code 44");
    });
    expect(() => deleteKeychain()).not.toThrow();
  });
});
