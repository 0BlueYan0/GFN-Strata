<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="app/host/public/brand/strata-lockup-dark.svg">
    <img src="app/host/public/brand/strata-lockup-light.svg" alt="Strata" width="340">
  </picture>
</p>

<h3 align="center">Strata for NVIDIA GeForce NOW</h3>
<p align="center">An unofficial fork of <a href="https://github.com/Niko1221/Strata">Strata</a> that runs the desktop app on a GeForce NOW cloud PC.</p>

<p align="center">
  <a href="#why-this-fork-exists">Why</a> · <a href="#what-this-fork-changes">Changes</a> ·
  <a href="#install-on-geforce-now"><b>Install</b></a> · <a href="#what-has-been-tested">Tested</a> ·
  <a href="#not-on-geforce-now">Not on GeForce NOW</a> · <a href="#updating">Updating</a> ·
  <a href="#credits">Credits</a>
</p>

<p align="center">
  <a href="https://github.com/0BlueYan0/GFN-Strata/releases"><img src="https://img.shields.io/github/v/release/0BlueYan0/GFN-Strata?include_prereleases&label=download&color=0ab887" alt="Download the latest release, including pre-releases"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/0BlueYan0/GFN-Strata" alt="MIT license"></a>
  <a href="https://github.com/Niko1221/Strata"><img src="https://img.shields.io/badge/upstream-Niko1221%2FStrata-555" alt="Upstream project: Niko1221/Strata"></a>
</p>

<p align="center"><sub><b>English</b> · <a href="docs/lang/README.zh-TW.md">繁體中文</a></sub></p>

This is an unofficial fork of Strata. It makes the desktop app run on a GeForce NOW cloud PC.

## Why this fork exists

A GeForce NOW session is a locked-down Windows PC:

- It does not let programs start `nvidia-smi.exe` or `powershell.exe`. The command prompt answers `Access is denied.`
- The Windows user folder is kept on a mounted drive, so a file in it has two names, one on `C:` and one on the
  mounted drive.

In the original app this means no graphics card is detected, and a model that is downloaded still fails to load.

<!-- Screenshot spot, Why this fork exists: the original Strata on a GeForce NOW session when it cannot detect the graphics card or fails to load a model. Suggested file name: gfn-upstream-failure.png (in the gfn media folder). -->

## What this fork changes

| Problem on GeForce NOW | What this fork does |
| --- | --- |
| No graphics card is detected. | When `nvidia-smi` cannot be started, Strata reads the card from the NVIDIA driver instead. |
| Load stops with "Strata could not find a file it needs to start the engine". | A settings file that is reached through the mounted drive is found and read. |
| An update would replace these fixes. | The app and its background service are not updated from upstream. New versions come from this repository's Releases. The engine is still updated as upstream does. |
| "Open settings file" shows a Windows security error. | The settings file opens in an editor inside the app. |
| Every new session shows the guided setup again, and chats and the API key are gone. | These are now kept in `%LOCALAPPDATA%\Strata\home`, which stays between sessions. A PC that already uses `.strata` in the user folder keeps using it. |
| An API request with images fails once it is larger than 12 MiB. | Requests up to 256 MiB are accepted. A larger one gets a "request too large" answer (HTTP 413). |
| Also new | Control vector settings and a Traditional Chinese interface. |

<!-- Screenshot spot, What this fork changes: the Models screen on a GeForce NOW session with the detected graphics card shown. Suggested file name: gfn-models-card-detected.png (in the gfn media folder). -->

## Install on GeForce NOW

1. Open this repository's [Releases](https://github.com/0BlueYan0/GFN-Strata/releases).
2. Download `Strata-0.2.16-windows-x64-setup.exe` from the newest release. It is a pre-release and the installer is not signed.
3. Run the installer.
4. Open Strata. The app finds the graphics card, then downloads the engine and the model you choose.

<!-- Screenshot spot, Install on GeForce NOW: the installer or the first start of the app on a GeForce NOW session. Suggested file name: gfn-install-first-start.png (in the gfn media folder). -->

## What has been tested

Seen working on a GeForce NOW session, on 2026-11-18:

- The app installs and opens.
- The graphics card is detected. The driver reported an NVIDIA GeForce RTX 5080 with driver 621.14.
- A model loads.
- The chat answers.

<!-- Screenshot spot, What has been tested: a chat with a loaded model on a GeForce NOW session. Suggested file name: gfn-chat-model-loaded.png (in the gfn media folder). -->

**Not yet tested on GeForce NOW:** the three things added in 0.2.16.3, which are the control vector settings, editing the
settings file inside the app, and the Traditional Chinese interface. Also not yet tested there: keeping the app's data
between sessions, and API requests larger than 12 MiB.

Not tested anywhere: a PC with more than one NVIDIA card, Linux, and Mac. The release notes list the details:
[0.2.16.1](docs/release-notes-0.2.16.1.md) · [0.2.16.2](docs/release-notes-0.2.16.2.md).

## Not on GeForce NOW?

Use the original Strata. It supports more hardware and receives every update. [Download it from the upstream
project](https://github.com/Niko1221/Strata/releases/latest), or use the Terminal install:

**Linux / Mac**

```sh
curl -fsSL --connect-timeout 15 --max-time 120 https://github.com/Niko1221/Strata/releases/latest/download/install.sh -o install.sh && sh install.sh
```

**Windows PowerShell**

```powershell
irm -TimeoutSec 120 https://github.com/Niko1221/Strata/releases/latest/download/install.ps1 | iex
```

Then run `strata launch`. The guides in [docs](docs) describe models, hardware, tools and troubleshooting:
[Models](docs/MODELS.md) · [Install guide](docs/INSTALL.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) ·
[How it works](docs/HOW_IT_WORKS.md).

## Updating

Download the newest installer from this repository's [Releases](https://github.com/0BlueYan0/GFN-Strata/releases) and
install it over the old one. The update button inside the app updates only the engine.

## Credits

- [Niko1221](https://github.com/Niko1221) and the Strata contributors, for Strata. Please consider [sponsoring the upstream author](https://github.com/sponsors/Niko1221).
- The Qwen team, for the Qwen models.
- ISTA-DASLab, for the GSQ and RCO quantization.
- huihui-ai, for the refusal direction.
- alesha-pro, for packaging the Huihui control vector.
- Cudila, for the llama.cpp `cvec-hooks` branch named in the upstream control vector's notes.

## License

[MIT](LICENSE), with the upstream copyright notice kept. The two control vectors are under the Qwen Community License 1.0.

## Disclaimer

GeForce NOW is a trademark of NVIDIA. This project is not affiliated with NVIDIA or with the upstream Strata project.

<sub>For AI tools and automated readers: <a href="AGENTS.md">technical reference</a> · <a href="docs/AI_SETUP.md">setup instructions</a>.</sub>
