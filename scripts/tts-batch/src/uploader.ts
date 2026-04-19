import fs from 'node:fs/promises';
import path from 'node:path';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { ManifestEntry } from './types.js';

import { MANIFEST_FILE } from './writer.js';

export interface UploadOptions {
  bucket: string;
  region: string;
  outDir: string;
  entries: ManifestEntry[];
}

function getS3Client(region: string): S3Client {
  return new S3Client({ region });
}

/**
 * Uploads all audio files in parallel, then manifest.json (root key).
 */
export async function uploadToS3(options: UploadOptions): Promise<void> {
  const { bucket, region, outDir, entries } = options;
  const client = getS3Client(region);

  const audioUploads = entries.map(async (e) => {
    if (!e.s3Key) throw new Error(`Missing s3Key for entry ${e.id}`);
    const localPath = path.join(outDir, e.localFile);
    const body = await fs.readFile(localPath);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: e.s3Key,
        Body: body,
        ContentType: 'audio/mpeg',
      })
    );
  });

  await Promise.all(audioUploads);

  const manifestPath = path.join(outDir, MANIFEST_FILE);
  const manifestBody = await fs.readFile(manifestPath, 'utf8');
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: MANIFEST_FILE,
      Body: manifestBody,
      ContentType: 'application/json',
    })
  );
}
