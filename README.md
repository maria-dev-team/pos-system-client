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
installer when a semantic version tag such as `v1.0.1` is pushed. The
application version is taken from that tag during the build, so updating and
committing `package.json` before a release is not required.

Configure this repository variable in **Settings → Secrets and variables →
Actions → Variables**:

- `POS_API_URL` — production API URL embedded into the application.

The workflow downloads a pinned Windows x64 LGPL FFmpeg build and verifies its
SHA-256 checksum. No FFmpeg variables or committed binary are required.

### Publishing a release

Tag the release commit and push only the tag:

```bash
git switch main
git pull --ff-only
git tag v1.0.1
git push origin v1.0.1
```

Do not create or publish the GitHub Release manually. The workflow:

1. runs the tests and builds the Windows installer;
2. creates or reuses a draft GitHub Release;
3. uploads and verifies the installer, blockmap, and `latest.yml`;
4. publishes the release only after every artifact is ready.

This order prevents POS clients from seeing an incomplete update. If the build
or upload fails, no broken release is published; the workflow can be rerun while
the existing draft remains hidden from users.

The public download URL for the latest installer is stable:

```text
https://github.com/maria-dev-team/pos-system-client/releases/latest/download/dukenai-pos-setup.exe
```

The repository must be public for unauthenticated downloads from a website. If
the repository is private, release assets require GitHub authentication and
cannot be used as a public download URL.
