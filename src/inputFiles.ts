import { open, type FileHandle } from "node:fs/promises";
import { basename, extname } from "node:path";
import {
  FileUploadError, MAX_INPUT_FILES, MAX_INPUT_FILE_BYTES, MAX_INPUT_RUN_BYTES, uploadWorkerFile,
  type FileInput, type WorkerKitClient,
} from "@workerkit/core";

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
};
const MIB = 1024 * 1024;

/** A problem with the local selection: nothing was uploaded, and the message is safe to print. */
export class FileSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileSelectionError";
  }
}

interface SelectedFile { handle: FileHandle; name: string; contentType: string; size: number }

/**
 * Upload the files named on the command line and return the references `worker_run` takes in
 * `inputs`. Files are read as opaque bytes and never parsed. The whole selection is checked before
 * the first upload is reserved, and every finished upload is revoked when a later one fails.
 */
export async function uploadRunFiles(client: WorkerKitClient, token: string, tokenId: number, paths: string[]): Promise<FileInput[]> {
  const selected = await selectFiles(paths);
  const inputs: FileInput[] = [];
  try {
    for (const file of selected) {
      const bytes = await readExact(file);
      try {
        inputs.push(await uploadWorkerFile(client, token, tokenId, { name: file.name, contentType: file.contentType, bytes }));
      } finally {
        bytes.fill(0);
      }
    }
    return inputs;
  } catch (error) {
    await Promise.all(inputs.map(input =>
      client.delete(`/api/manage/workers/${tokenId}/files/${input.fileId}`, { token }).catch(() => undefined)));
    throw error instanceof FileSelectionError ? error : new Error(describeUploadFailure(error));
  } finally {
    await Promise.all(selected.map(file => file.handle.close()));
  }
}

async function selectFiles(paths: string[]): Promise<SelectedFile[]> {
  if (paths.length < 1 || paths.length > MAX_INPUT_FILES) throw new FileSelectionError(`Choose 1 to ${MAX_INPUT_FILES} files.`);
  const selected: SelectedFile[] = [];
  try {
    let total = 0;
    for (const path of paths) {
      const name = basename(path);
      const contentType = CONTENT_TYPES[extname(path).toLowerCase()];
      if (!contentType) throw new FileSelectionError(`Files must be PDF, PNG or JPEG: ${name}`);
      let handle: FileHandle;
      try {
        handle = await open(path, "r");
      } catch (error) {
        throw new FileSelectionError(`Cannot open ${path}: ${(error as NodeJS.ErrnoException).code ?? "unreadable"}.`);
      }
      selected.push({ handle, name, contentType, size: 0 });
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size < 1 || stat.size > MAX_INPUT_FILE_BYTES) {
        throw new FileSelectionError(`${name} must be a regular file of 1 byte to ${MAX_INPUT_FILE_BYTES / MIB} MiB.`);
      }
      selected[selected.length - 1]!.size = stat.size;
      total += stat.size;
    }
    if (total > MAX_INPUT_RUN_BYTES) throw new FileSelectionError(`Files must total at most ${MAX_INPUT_RUN_BYTES / MIB} MiB.`);
    return selected;
  } catch (error) {
    await Promise.all(selected.map(file => file.handle.close()));
    throw error;
  }
}

/** Read the whole file into one buffer, refusing a file whose size changed meanwhile. */
async function readExact(file: SelectedFile): Promise<Buffer> {
  const bytes = Buffer.alloc(file.size);
  try {
    let offset = 0;
    while (offset < file.size) {
      const { bytesRead } = await file.handle.read(bytes, offset, file.size - offset, offset);
      if (!bytesRead) throw new FileSelectionError(`${file.name} changed while reading; select it again.`);
      offset += bytesRead;
    }
    if ((await file.handle.stat()).size !== file.size) throw new FileSelectionError(`${file.name} changed while reading; select it again.`);
    return bytes;
  } catch (error) {
    bytes.fill(0);
    throw error;
  }
}

/** Describe a failed upload from this CLI's own checks or the API's answer. Storage output is never echoed. */
function describeUploadFailure(error: unknown): string {
  const hint = "Check the worker's Files permissions and storage settings.";
  if (!(error instanceof FileUploadError)) return `File upload failed. ${hint}`;
  const reason = error.upstream?.error ?? error.code;
  const detail = error.upstream?.message ? ` (${error.upstream.message.replace(/\.$/, "")})` : "";
  return `File upload failed: ${reason}${detail}. ${hint}`;
}