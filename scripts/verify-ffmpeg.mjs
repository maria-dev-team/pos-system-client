import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { access, open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

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
  if (isWindows && process.platform === 'win32') {
    const executable = fileURLToPath(path);
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- Plain JavaScript packaging script.
    const run = (args) =>
      execFileSync(executable, ['-hide_banner', ...args], {
        encoding: 'utf8',
        timeout: 30_000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    if (
      !/\bdshow\b/.test(run(['-devices'])) ||
      !/\bh264_mf\b/.test(run(['-encoders']))
    ) {
      throw new Error('USB cameras require FFmpeg with dshow and h264_mf');
    }
    run([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x240:rate=15',
      '-t',
      '1',
      '-c:v',
      'h264_mf',
      '-hw_encoding',
      '0',
      '-b:v',
      '1500k',
      '-g',
      '75',
      '-bf',
      '0',
      '-f',
      'null',
      '-',
    ]);
  }
} catch (error) {
  const name = isWindows ? 'resources/ffmpeg.exe' : 'resources/ffmpeg';
  console.error(
    `Missing, invalid or unsupported ${name}: ${error.message}. Add a trusted ${isWindows ? 'Windows x64' : 'macOS'} FFmpeg build before packaging.`,
  );
  process.exitCode = 1;
}
