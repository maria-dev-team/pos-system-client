# Maria POS

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

The `Release Windows` GitHub Actions workflow builds and publishes a Windows
installer when a semantic version tag such as `v1.0.1` is pushed. The tag must
match the `version` field in `package.json`.

Configure this repository variable in **Settings → Secrets and variables →
Actions → Variables**:

- `POS_API_URL` — production API URL embedded into the application.

The workflow downloads a pinned Windows x64 LGPL FFmpeg build and verifies its
SHA-256 checksum. No FFmpeg variables or committed binary are required.

Create the first release from an up-to-date `main` branch (the current package
version is `1.0.0`):

```bash
$ git tag v1.0.0
$ git push origin v1.0.0
```

For subsequent patch releases:

```bash
$ npm version patch
$ git push origin main --follow-tags
```

Use `minor` or `major` instead of `patch` when appropriate. The public download
URL for the latest installer is stable:

```text
https://github.com/maria-dev-team/pos-system-client/releases/latest/download/Maria-POS-Setup.exe
```

The repository must be public for unauthenticated downloads from a website. If
the repository is private, release assets require GitHub authentication and
cannot be used as a public download URL.
