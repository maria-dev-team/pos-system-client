# Bundled FFmpeg

- Windows: place a trusted Windows x64 static build at
  `resources/ffmpeg.exe`, then run `npm run build:win`.

The GitHub release workflow downloads the pinned BtbN FFmpeg 8.1 Windows x64
LGPL static build and verifies the archive's SHA-256 checksum before packaging.
The binary is required locally only for manual packaging.

Pin the FFmpeg version and SHA-256 checksum in the release pipeline. Do not
download an unversioned `latest` binary during an application build. Keep the
binary's license notices with the installer and review the selected build's
codec/license configuration before distribution.

Electron Builder copies the binary to `process.resourcesPath`. The packaging
script validates the executable format, so a non-Windows binary cannot
accidentally be shipped as `ffmpeg.exe`.

USB anti-fraud capture requires DirectShow input and the `h264_mf` encoder on
Windows. It uses the Windows Media Foundation software encoder; `libx264` is
not required by the Windows LGPL bundle. The native packaging check verifies
both capabilities and runs a short synthetic encode before building an installer.
For development, macOS uses AVFoundation / `h264_videotoolbox`; Linux uses V4L2
stable device paths and requires an FFmpeg build with `libx264`.
