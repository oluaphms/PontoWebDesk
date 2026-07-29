import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { Downloader, ReleaseManifest } from './types.js';

function assertHttpsUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('ARTIFACT_URL_INVALID');
  }
  if (
    parsed.protocol !== 'https:' &&
    parsed.hostname !== '127.0.0.1' &&
    parsed.hostname !== 'localhost'
  ) {
    throw new Error('ARTIFACT_URL_MUST_BE_HTTPS');
  }
  return parsed;
}

function fileNameFromUrl(url: URL, version: string): string {
  const last = url.pathname.split('/').filter(Boolean).pop();
  if (last && last.includes('.')) return last;
  return `pontowebdesk-${version}.zip`;
}

export function createDownloader(): Downloader {
  return {
    async download(manifest: ReleaseManifest, destDir: string) {
      if (!manifest.artifactUrl) {
        throw new Error('ARTIFACT_URL_MISSING');
      }
      const url = assertHttpsUrl(manifest.artifactUrl);
      await mkdir(destDir, { recursive: true });
      const fileName = fileNameFromUrl(url, manifest.version);
      const filePath = join(destDir, fileName);

      const response = await fetch(url);
      if (!response.ok || !response.body) {
        throw new Error(`ARTIFACT_DOWNLOAD_FAILED_${response.status}`);
      }

      const nodeStream = Readable.fromWeb(
        response.body as import('node:stream/web').ReadableStream,
      );
      await pipeline(nodeStream, createWriteStream(filePath));

      const info = await stat(filePath);
      if (manifest.artifactSize != null && info.size !== manifest.artifactSize) {
        throw new Error('ARTIFACT_SIZE_MISMATCH');
      }
      return { filePath, size: info.size };
    },
  };
}
