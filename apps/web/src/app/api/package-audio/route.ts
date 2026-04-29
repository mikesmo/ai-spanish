import { type NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { assertApiUser } from '@/lib/auth/assert-api-user';

const ALLOWED_PACKAGE_AUDIO = {
  'no-you-try': 'no-you-try.mp3',
  success: 'success.mp3',
  success1: 'success1.mp3',
} as const;

type PackageAudioKey = keyof typeof ALLOWED_PACKAGE_AUDIO;

function isPackageAudioKey(raw: string | null): raw is PackageAudioKey {
  return raw != null && raw in ALLOWED_PACKAGE_AUDIO;
}

/** Resolve `packages/assets` binary without webpack tracing dynamic `require` over the whole package. */
function resolvePackageAssetPath(fileName: string): string {
  const candidates = [
    path.join(process.cwd(), 'node_modules', '@ai-spanish', 'assets', fileName),
    path.join(process.cwd(), '..', '..', 'packages', 'assets', fileName),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Asset not found: ${fileName}`);
}

export async function GET(request: NextRequest) {
  const auth = await assertApiUser(request);
  if (!auth.ok) return auth.response;

  const raw = request.nextUrl.searchParams.get('file');
  if (!isPackageAudioKey(raw)) {
    return NextResponse.json({ error: 'Invalid file parameter' }, { status: 400 });
  }

  const fileName = ALLOWED_PACKAGE_AUDIO[raw];

  try {
    const resolved = resolvePackageAssetPath(fileName);
    const buf = await fsPromises.readFile(resolved);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('[package-audio]', err);
    return NextResponse.json({ error: 'Failed to load audio' }, { status: 500 });
  }
}
