# Strata 0.2.16.2 (pre-release): a model loads when the user folder is on a mounted drive

This is a pre-release of the fork at https://github.com/0BlueYan0/GFN-Strata. The app and the Terminal are 0.2.16. Control is 0.1.62.2. The engine is upstream 0.1.62. Everything in 0.2.16.1 is still here.

## What you will notice

- **Load works on GeForce NOW.** On GeForce NOW the Windows user folder (`C:\Users\kiosk`) is kept on a mounted drive. Before, pressing Load showed "Strata could not find a file it needs to start the engine", and Details showed `ENOENT: no such file or directory, lstat 'I:\...'`. Now the model's settings file is found and the load goes on.
- A settings file outside the Strata install folder is still refused, as before.
- On other PCs nothing changes.

## What we checked

- On a GeForce NOW session, the install folder `%LOCALAPPDATA%\Strata\install` and the same folder named through the mounted drive (`I:\...\install`) are one folder: both names gave the same file ID and volume number. The settings file under the mounted name could be read.
- On a Windows PC, a test that stands a folder link in for the mounted drive: the load failed with the same `ENOENT ... lstat` message before this change and succeeds after it. A settings file in another folder is still refused.

## What we did not test

- This release on GeForce NOW. The load there was not run with this installer yet.
- Whether the engine starts and answers on GeForce NOW after the load gets past this step.

## Updating

- Install the new installer from https://github.com/0BlueYan0/GFN-Strata/releases over the old one.
- The in-app updater does not install the app or Control. The engine is still offered by the in-app updater and by `strata update`.

## Downloads

One Windows installer, `Strata-0.2.16-windows-x64-setup.exe`. It is not signed.
