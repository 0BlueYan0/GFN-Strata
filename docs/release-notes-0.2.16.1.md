# Strata 0.2.16.1 (pre-release): graphics cards are found when nvidia-smi is blocked

This is a pre-release of the fork at https://github.com/0BlueYan0/GFN-Strata. The app and the Terminal are 0.2.16. Control is 0.1.62.1. The engine is upstream 0.1.62. The harness comes from the upstream 0.2.16 installer.

This release includes all changes from upstream 0.2.16. See the [upstream release notes](https://github.com/Niko1221/Strata/releases/tag/v0.2.16).

## What you will notice

- **An NVIDIA card is found even when `nvidia-smi` cannot be started.** Some places do not let programs start `nvidia-smi.exe`. GeForce NOW is one: the command prompt there answers `Access is denied.`. Before, Strata showed "no NVIDIA GPU found (nvidia-smi did not answer)", the Models screen showed no card, and the model could not be downloaded and loaded. Now Strata asks `nvidia-smi` first, and when it cannot be started it reads the card from the NVIDIA driver itself. Models and Monitor show the card, with its memory, driver version, temperature and load, and Download & load goes on. This covers setup, the Terminal, the server and the app. When `nvidia-smi` works, Strata behaves as in upstream 0.2.16. If the driver library is blocked too, Strata still says "no NVIDIA GPU found".
- **Off:** set `STRATA_NVML_CARDS=0` to switch the fallback off.
- **This build does not offer updates for the app or for Control.** The settings page and `strata update` show no new app or Control version, and Strata does not install an app or Control update from the upstream project. To get a newer version of this build, download the installer from https://github.com/0BlueYan0/GFN-Strata/releases. Engine packages and the draft model are still downloaded and updated as before.

## What we measured

The following measurements were made for the previous pre-release, based on upstream 0.2.15. Except for the GeForce NOW library read noted below, they are from one PC with an RTX 4070 SUPER (driver 610.62) where `nvidia-smi` works, run with an Anaconda Python, not the one inside the app.

- Name, UUID, PCI address, total memory, compute capability, driver version, display flag and compute mode were identical in the driver's answer and in `nvidia-smi`'s. Used and free memory were the same once rounded the same way.
- With `nvidia-smi` and PowerShell both made unable to start on that PC, setup read the card in about 0.2 s. The app's card detection took 2,870 to 3,157 ms, and each Monitor reading took 151 to 202 ms (PC idle).
- On a GeForce NOW session (RTX 5080, driver 621.14), we read the card by hand through the driver library from a Python process: name, memory (49,152 MiB), driver and compute capability all came back. This was a read of the library only, not a run of this release.

## What we did not test

- This release on GeForce NOW. We have not run the installer there yet.
- Whether Strata's engine program (`strata.exe`) can be started on GeForce NOW. If it is blocked, Download & load will stop at the engine start.
- A PC with more than one NVIDIA card: the order of the cards may differ from `nvidia-smi`.
- Linux.
- The time of a card read with the Python inside the app, and the time of its first start on GeForce NOW.
- The PCIe link line in setup does not appear when only the driver library is available, and the Monitor has no PCIe traffic then.

## Updating

- Install the new installer from https://github.com/0BlueYan0/GFN-Strata/releases over the old one.
- The in-app updater does not install the app or Control. The engine is still offered by the in-app updater and by `strata update`.

## Downloads

One Windows installer, `Strata-0.2.16-windows-x64-setup.exe`. It is not signed.
