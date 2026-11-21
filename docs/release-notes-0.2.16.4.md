# Strata 0.2.16.4 (pre-release): app data that stays between GeForce NOW sessions, and larger API requests

This is a pre-release of the fork at https://github.com/0BlueYan0/GFN-Strata. The app and the Terminal are 0.2.16. Control is 0.1.62.4. The engine is upstream 0.1.62. Everything in 0.2.16.3 is still here.

## What you will notice

- **The guided setup no longer comes back every session on GeForce NOW.** On Windows the app now keeps its own data (chats, the API key, the guided setup state, the model folder choice) in `%LOCALAPPDATA%\Strata\home`. On GeForce NOW this folder stays between sessions; `%USERPROFILE%\.strata`, where the data was before, does not. A PC that already has data in `%USERPROFILE%\.strata` keeps using it, and nothing is moved.
- **API requests up to 256 MiB.** The app's API (`/v1/chat/completions`, `/v1/messages`, `/v1/responses`) took at most 12 MiB per request, so a tool such as OpenCode that sends screenshots stopped once a conversation grew past that, with "Request body too large". With a model loaded the limit is now 256 MiB, the same as the model server behind it. A larger request gets HTTP 413 with the message `the request body is larger than 256 MiB (STRATA_MAX_BODY_MIB raises the limit)`, in the OpenAI shape, or in the Anthropic shape for `/v1/messages`. Before, it got HTTP 500 or a dropped connection.
- The uninstaller page now says that the `%LOCALAPPDATA%\Strata` folder also holds chats and app settings.

## What we checked

- On a Windows PC: the new tests for the data folder and the request limit, the app's type check and build, and the installer page test. Started the app's background service with the existing `%USERPROFILE%\.strata`: it kept using it. Started it with an empty user folder: it wrote to `%LOCALAPPDATA%\Strata\home`. With no model loaded, a 5 MiB request got HTTP 413 six times out of six, in both shapes.
- The full app test run was stopped at its 30 minute limit with 1210 passed and 62 failed. The failing test files that were run again on 0.2.16.3 failed there too.

## What we did not test

- This release on GeForce NOW.
- A request between 12 MiB and 256 MiB with a real model loaded. That path was only run with a stand-in for the engine.
- What OpenCode does when it gets HTTP 413.

## Known limits

- A request that takes longer than about 300 seconds to upload gets HTTP 408, whatever its size (measured on a Windows PC: a 3 MiB and a 5 MiB request sent over 330 seconds both got 408). To fit in that time, 256 MiB needs an upload speed of about 7.2 Mbit/s.

## Updating

- Install the new installer from https://github.com/0BlueYan0/GFN-Strata/releases over the old one.
- The in-app updater does not install the app or Control. The engine is still offered by the in-app updater and by `strata update`.

## Downloads

One Windows installer, `Strata-0.2.16-windows-x64-setup.exe`. It is not signed.
