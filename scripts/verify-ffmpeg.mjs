import { constants } from 'node:fs';
import { access, open } from 'node:fs/promises';

const targetPlatform = process.argv[2];
const isWindows = targetPlatform === 'win32';
const path = new URL(
  isWindows ? '../resources/ffmpeg.exe' : '../resources/ffmpeg',
  import.meta.url,
);

try {
  await access(
    path,
    isWindows ? constants.R_OK : constants.R_OK | constants.X_OK,
  );
  const file = await open(path, 'r');
  const header = Buffer.alloc(4);
  await file.read(header, 0, header.length, 0);
  await file.close();
  const isPe = header[0] === 0x4d && header[1] === 0x5a;
  const magic = header.readUInt32BE(0);
  const isMachO = [
    0xcafebabe, 0xbebafeca, 0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe,
  ].includes(magic);
  if ((isWindows && !isPe) || (!isWindows && !isMachO)) {
    throw new Error('FFmpeg binary is for the wrong platform');
  }
} catch {
  const name = isWindows ? 'resources/ffmpeg.exe' : 'resources/ffmpeg';
  console.error(
    `Missing or invalid ${name}. Add a trusted ${isWindows ? 'Windows x64' : 'macOS'} FFmpeg build before packaging.`,
  );
  process.exitCode = 1;
}
