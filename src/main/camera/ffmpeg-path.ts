import { app } from 'electron';
import { existsSync } from 'fs';
import { join } from 'path';

export const resolveFfmpegPath = (
  isPackaged = app.isPackaged,
  resourcesPath = process.resourcesPath,
  appPath = app.getAppPath(),
): string => {
  const executableName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  if (isPackaged) return join(resourcesPath, executableName);
  const candidates = [
    ...(process.env.FFMPEG_PATH ? [process.env.FFMPEG_PATH] : []),
    join(
      appPath,
      'resources',
      'ffmpeg',
      `${process.platform}-${process.arch}`,
      executableName,
    ),
    join(appPath, 'resources', executableName),
    join(process.cwd(), 'resources', executableName),
    ...(process.platform === 'darwin'
      ? ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']
      : []),
  ];
  const executable = candidates.find((candidate) => existsSync(candidate));
  return executable ?? executableName;
};
