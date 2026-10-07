import { afterEach, describe, expect, it, vi } from "vitest";
import { api, request } from "../src/api";

afterEach(() => vi.unstubAllGlobals());
describe("backend client", () => {
  it("uploads to the returned object session before completing the revision", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "upload",
            url: "https://storage.example/session",
            mime: "text/plain",
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(""))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "asset", status: "pending" })),
      );
    vi.stubGlobal("fetch", fetch);
    const asset = await api.upload(
      "collection",
      new File(["text"], "a.txt", { type: "text/plain" }),
      "existing",
    );
    expect(asset.status).toBe("pending");
    expect(JSON.parse(fetch.mock.calls[0][1].body).replace).toBe("existing");
    expect(fetch.mock.calls[1][0]).toBe("https://storage.example/session");
    expect(fetch.mock.calls[1][1].method).toBe("PUT");
    expect(fetch.mock.calls[2][0]).toBe("/api/v1/uploads/upload/complete");
  });
  it("never completes a failed byte upload", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "upload", url: "/bytes", mime: "text/plain" }),
        ),
      )
      .mockResolvedValueOnce(new Response("failed", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      api.upload("collection", new File(["text"], "a.txt")),
    ).rejects.toThrow("Upload failed");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("surfaces actionable server errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ detail: "Configure Gemini on the server." }),
            { status: 503 },
          ),
        ),
    );
    await expect(request("/config")).rejects.toThrow(
      "Configure Gemini on the server.",
    );
  });
  it("accepts empty successful deletion responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
    await expect(api.remove("asset")).resolves.toBeUndefined();
  });
});
