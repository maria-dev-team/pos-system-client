import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { resolveFfmpegPath } from './ffmpeg-path';

describe('resolveFfmpegPath', () => {
  it('uses the Electron resources directory in a packaged build', () => {
    const resourcesPath = join('absolute', 'app-resources');
    const executableName =
      process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

    expect(resolveFfmpegPath(true, resourcesPath, 'unused')).toBe(
      join(resourcesPath, executableName),
    );
  });
});
