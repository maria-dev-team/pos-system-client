# DukenAI POS

Кассовое Electron-приложение на React и TypeScript.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
$ npm run build:win
```

Before packaging, place a trusted Windows x64 FFmpeg executable at
`resources/ffmpeg.exe`.

## Windows releases

The `Release Windows` GitHub Actions workflow builds and uploads a Windows
installer when a GitHub Release is published. The application version is taken
from a semantic version tag such as `v1.0.1` during the build.

Configure this repository variable in **Settings → Secrets and variables →
Actions → Variables**:

- `POS_API_URL` — production API URL embedded into the application.

The workflow downloads a pinned Windows x64 LGPL FFmpeg build and verifies its
SHA-256 checksum. No FFmpeg variables or committed binary are required.

To publish any version, open GitHub **Releases → Draft a new release**, create a
new tag in the `vMAJOR.MINOR.PATCH` format (for example, `v1.0.0` or `v1.0.1`),
select `main`, and publish the release. Updating and committing `package.json`
before a release is not required. The public download URL for the latest
installer is stable:

```text
https://github.com/maria-dev-team/pos-system-client/releases/latest/download/dukenai-pos-setup.exe
```

The repository must be public for unauthenticated downloads from a website. If
the repository is private, release assets require GitHub authentication and
cannot be used as a public download URL.
