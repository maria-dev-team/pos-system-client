# Bundled FFmpeg

- Windows: place a trusted Windows x64 static build at
  `resources/ffmpeg.exe`, then run `npm run build:win`.
- macOS: place the native executable at `resources/ffmpeg`, make it executable,
  then run `npm run build:mac`. Use the binary matching the target (`arm64` or
  `x64`).

Pin the FFmpeg version and SHA-256 checksum in the release pipeline. Do not
download an unversioned `latest` binary during an application build. Keep the
binary's license notices with the installer and review the selected build's
codec/license configuration before distribution.

Electron Builder copies only the current platform binary to
`process.resourcesPath`. The packaging scripts validate the executable format,
so a Homebrew Mach-O binary cannot accidentally be shipped as `ffmpeg.exe`.
The macOS check also fails when the executable bit is missing.

For macOS development, a bundled file is optional: the Main process also checks
`FFMPEG_PATH`, `/opt/homebrew/bin/ffmpeg`, `/usr/local/bin/ffmpeg`, and `PATH`.
