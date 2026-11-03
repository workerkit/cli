import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileUploadError, uploadWorkerFile, type WorkerKitClient } from "@workerkit/core";
import { FileSelectionError, uploadRunFiles } from "../../src/inputFiles.js";
import { renderRunResult } from "../../src/output/runReceipt.js";

vi.mock("@workerkit/core", async original => ({ ...await original<object>(), uploadWorkerFile: vi.fn() }));
const paths: string[] = [];
afterEach(async () => { vi.resetAllMocks(); await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function selection() {
  const dir = await mkdtemp(join(tmpdir(), "wk-file-intake-test-")); paths.push(dir);
  const file = join(dir, "invoice.pdf");
  await writeFile(file, new Uint8Array([0, 255, 3])); // Intentionally not a valid document.
  return { dir, file };
}

const failing = async (promise: Promise<unknown>): Promise<Error> => (await promise.then(() => undefined, (error: unknown) => error)) as Error;

describe("run file intake", () => {
  it("transfers opaque bytes and clears its buffer after the upload returns", async () => {
    const { file } = await selection();
    let borrowed: Uint8Array | undefined;
    vi.mocked(uploadWorkerFile).mockImplementation(async (_client, _token, _id, input) => {
      expect([...input.bytes]).toEqual([0, 255, 3]); borrowed = input.bytes;
      return { kind: "file", fileId: "ready" };
    });
    const client = { delete: vi.fn() } as unknown as WorkerKitClient;
    expect(await uploadRunFiles(client, "key", 42, [file])).toEqual([{ kind: "file", fileId: "ready" }]);
    expect([...borrowed!]).toEqual([0, 0, 0]);
  });

  it("refuses an unsupported file type before reserving any upload", async () => {
    const { dir, file } = await selection();
    const failure = await failing(uploadRunFiles({} as WorkerKitClient, "key", 42, [file, join(dir, "program.exe")]));
    expect(failure).toBeInstanceOf(FileSelectionError);
    expect(failure.message).toBe("Files must be PDF, PNG or JPEG: program.exe");
    expect(uploadWorkerFile).not.toHaveBeenCalled();
  });

  it("names a file it cannot open and limits a selection to three files", async () => {
    const { dir, file } = await selection();
    await expect(uploadRunFiles({} as WorkerKitClient, "key", 42, [join(dir, "missing.pdf")])).rejects.toThrow(/^Cannot open .*missing\.pdf: ENOENT\.$/);
    await expect(uploadRunFiles({} as WorkerKitClient, "key", 42, [file, file, file, file])).rejects.toThrow("Choose 1 to 3 files.");
    expect(uploadWorkerFile).not.toHaveBeenCalled();
  });

  it("revokes earlier uploads when a later file fails without exposing provider errors", async () => {
    const { dir, file } = await selection();
    const other = join(dir, "other.pdf"); await writeFile(other, "opaque");
    vi.mocked(uploadWorkerFile).mockResolvedValueOnce({ kind: "file", fileId: "ready" }).mockRejectedValueOnce(new Error("https://secret-upload"));
    const remove = vi.fn().mockResolvedValue(undefined);
    const failure = await failing(uploadRunFiles({ delete: remove } as unknown as WorkerKitClient, "key", 42, [file, other]));
    expect(failure.message).toBe("File upload failed. Check the worker's Files permissions and storage settings.");
    expect(remove).toHaveBeenCalledExactlyOnceWith("/api/manage/workers/42/files/ready", { token: "key" });
  });

  it("reports the API's refusal code and message when a reservation is refused", async () => {
    const { file } = await selection();
    vi.mocked(uploadWorkerFile).mockRejectedValueOnce(new FileUploadError("file_prepare_failed",
      { status: 409, error: "file_storage_not_configured", message: "Setup required: configure private file storage before uploading." }));
    await expect(uploadRunFiles({ delete: vi.fn() } as unknown as WorkerKitClient, "key", 42, [file])).rejects.toThrow(
      "File upload failed: file_storage_not_configured (Setup required: configure private file storage before uploading). Check the worker's Files permissions and storage settings.");
  });

  it("prints receipt lifecycle and forwarding denial but respects withheld content", () => {
    const receipt = { inputs: [{ name: "invoice.pdf", handoffStatus: "received", storageStatus: "deleted", readStatus: "denied",
      notice: "attachment_forwarding_disabled", saves: [{ status: "confirmed", fileId: "google:original" }] }] };
    expect(renderRunResult(receipt).join("\n")).toContain("forwarding attachments to the model is not permitted");
    expect(renderRunResult(receipt).join("\n")).toContain("storage deleted");
    expect(renderRunResult(receipt).join("\n")).toContain("google:original");
    expect(renderRunResult({ ...receipt, contentWithheld: true })).toEqual([]);
  });
});