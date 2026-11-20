<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../app/host/public/brand/strata-lockup-dark.svg">
    <img src="../../app/host/public/brand/strata-lockup-light.svg" alt="Strata" width="340">
  </picture>
</p>

<h3 align="center">Strata for NVIDIA GeForce NOW</h3>
<p align="center"><a href="https://github.com/Niko1221/Strata">Strata</a> 的非官方 fork，讓桌面 App 能在 GeForce NOW 雲端電腦上執行。</p>

<p align="center">
  <a href="#為什麼需要這個-fork">為什麼</a> · <a href="#這個-fork-改了什麼">改了什麼</a> ·
  <a href="#在-geforce-now-安裝"><b>安裝</b></a> · <a href="#驗證狀態">驗證狀態</a> ·
  <a href="#不在-geforce-now-上">不在 GeForce NOW 上</a> · <a href="#怎麼更新">更新</a> ·
  <a href="#致謝">致謝</a>
</p>

<p align="center">
  <a href="https://github.com/0BlueYan0/GFN-Strata/releases"><img src="https://img.shields.io/github/v/release/0BlueYan0/GFN-Strata?include_prereleases&label=download&color=0ab887" alt="下載最新版本，包含 pre-release"></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/github/license/0BlueYan0/GFN-Strata" alt="MIT 授權"></a>
  <a href="https://github.com/Niko1221/Strata"><img src="https://img.shields.io/badge/upstream-Niko1221%2FStrata-555" alt="上游專案：Niko1221/Strata"></a>
</p>

<p align="center"><sub><a href="../../README.md">English</a> · <b>繁體中文</b></sub></p>

這是 Strata 的非官方 fork，讓桌面 App 能在 GeForce NOW 雲端電腦上跑。

## 為什麼需要這個 fork

GeForce NOW 的連線是一台受到限制的 Windows 電腦：

- 不允許程式啟動 `nvidia-smi.exe` 與 `powershell.exe`。命令提示字元會回應 `Access is denied.`
- Windows 的使用者資料夾放在掛載的磁碟上，所以裡面的檔案有兩個名稱，一個在 `C:`，一個在掛載磁碟上。

在原版 App 裡，結果是偵測不到顯示卡，下載好的模型也載入失敗。

<!-- 截圖位置，為什麼需要這個 fork：GeForce NOW 上的原版 Strata 偵測不到顯示卡或載入模型失敗的畫面。建議檔名 gfn-upstream-failure.png（放在 gfn 媒體資料夾）。 -->

## 這個 fork 改了什麼

| 在 GeForce NOW 遇到的問題 | 這個 fork 怎麼解 |
| --- | --- |
| 偵測不到顯示卡。 | `nvidia-smi` 無法啟動時，Strata 改從 NVIDIA 驅動程式讀取顯示卡資訊。 |
| 載入停在「Strata could not find a file it needs to start the engine」。 | 經過掛載磁碟的設定檔路徑也能找到並讀取。 |
| 更新會蓋掉這些修正。 | App 與它的背景服務不從上游更新，新版從這個 repo 的 Releases 下載。引擎仍照上游更新。 |
| 「Open settings file」跳出 Windows 安全性錯誤。 | 設定檔改在 App 內的編輯器開啟。 |
| 另外新增 | 控制向量設定與繁體中文介面。 |

<!-- 截圖位置，這個 fork 改了什麼：GeForce NOW 上的模型頁，顯示偵測到的顯示卡。建議檔名 gfn-models-card-detected.png（放在 gfn 媒體資料夾）。 -->

## 在 GeForce NOW 安裝

1. 開啟這個 repo 的 [Releases](https://github.com/0BlueYan0/GFN-Strata/releases)。
2. 從最新版下載 `Strata-0.2.16-windows-x64-setup.exe`。它是 pre-release，安裝檔沒有簽章。
3. 執行安裝程式。
4. 開啟 Strata。App 會找到顯示卡，接著下載引擎與你選的模型。

<!-- 截圖位置，在 GeForce NOW 安裝：GeForce NOW 上的安裝程式或 App 第一次啟動的畫面。建議檔名 gfn-install-first-start.png（放在 gfn 媒體資料夾）。 -->

## 驗證狀態

2026-11-18 在 GeForce NOW 上親眼看過可以運作：

- App 安裝並開啟。
- 偵測到顯示卡。驅動程式回報 NVIDIA GeForce RTX 5080，驅動版本 621.14。
- 模型載入成功。
- 聊天有回應。

<!-- 截圖位置，驗證狀態：GeForce NOW 上已載入模型的聊天畫面。建議檔名 gfn-chat-model-loaded.png（放在 gfn 媒體資料夾）。 -->

**尚未在 GeForce NOW 驗證：** 0.2.16.3 新增的三項，也就是控制向量設定、App 內編輯設定檔、繁體中文介面。

任何地方都還沒測過：多張 NVIDIA 顯示卡的電腦、Linux、Mac。細節請看版本說明：
[0.2.16.1](../release-notes-0.2.16.1.md) · [0.2.16.2](../release-notes-0.2.16.2.md)。

## 不在 GeForce NOW 上？

請使用原版 Strata。它支援更多硬體，也會收到每一次更新。可以[到上游專案下載](https://github.com/Niko1221/Strata/releases/latest)，或用終端機安裝：

**Linux / Mac**

```sh
curl -fsSL --connect-timeout 15 --max-time 120 https://github.com/Niko1221/Strata/releases/latest/download/install.sh -o install.sh && sh install.sh
```

**Windows PowerShell**

```powershell
irm -TimeoutSec 120 https://github.com/Niko1221/Strata/releases/latest/download/install.ps1 | iex
```

接著執行 `strata launch`。[docs](../) 裡的指南說明模型、硬體、工具與疑難排解：
[模型](../MODELS.md) · [安裝指南](../INSTALL.md) · [疑難排解](../TROUBLESHOOTING.md) ·
[運作方式](../HOW_IT_WORKS.md)。

## 怎麼更新

到這個 repo 的 [Releases](https://github.com/0BlueYan0/GFN-Strata/releases) 下載最新的安裝檔，直接安裝在舊版上。App 內的更新按鈕只會更新引擎。

## 致謝

- [Niko1221](https://github.com/Niko1221) 與 Strata 貢獻者，感謝他們做出 Strata。也請考慮[贊助上游作者](https://github.com/sponsors/Niko1221)。
- Qwen 團隊，提供 Qwen 模型。
- ISTA-DASLab，提供 GSQ 與 RCO 量化。
- huihui-ai，提供拒絕方向。
- alesha-pro，封裝 Huihui 控制向量。
- Cudila，上游控制向量說明裡提到的 llama.cpp `cvec-hooks` 分支。

## 授權

[MIT](../../LICENSE)，保留上游的著作權聲明。兩個控制向量適用 Qwen Community License 1.0。

## 聲明

GeForce NOW 是 NVIDIA 的商標。這個專案與 NVIDIA 及上游 Strata 專案沒有隸屬關係。

<sub>給 AI 工具與自動讀取者：<a href="../../AGENTS.md">技術參考</a> · <a href="../AI_SETUP.md">安裝說明</a>。</sub>
