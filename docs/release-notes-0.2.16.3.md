# Strata 0.2.16.3 (pre-release): control vector settings, an in-app settings file editor and Traditional Chinese

This is a pre-release of the fork at https://github.com/0BlueYan0/GFN-Strata. The app and the Terminal are 0.2.16. Control is 0.1.62.3. The engine is upstream 0.1.62. Everything in 0.2.16.2 is still here.

## What you will notice

- **Control vector settings on the Models page.** Open Expert mode on the Models page. The new Control vector section turns a control vector on or off and sets the vector, the strength, the first and last layer, the mode (`project` or `add`) and the direction (`per-layer` or `single`). The settings are written into the model's settings file and apply the next time the model loads. The info icon next to the title explains what the vector does and who is responsible for what the model writes with it on.
- **Two vectors to choose from.** The built-in Strata vector, and the Huihui refusal direction by alesha-pro, which now ships in the installer under `control\data\control-vector-huihui\` with its license. A custom `.gguf` file can be named by its full path. The two built-in vectors were made for the original Qwen3.8-Flash-Next.
- **"Open settings file" opens an editor inside the app.** It no longer starts Notepad, so it no longer shows the Windows security error on GeForce NOW. A file that is not valid JSON is not saved, and the editor shows the line with the error. If another program changed the file in the meantime, the editor offers to reload it first.
- **Traditional Chinese.** Settings → Language has 中文（繁體）. It covers the app, the tray menu and the server's own web page.
- When one of Control vector, Expert settings or the settings file editor saves, the other two reload what is now in the file.

## What we checked

- On a Windows PC: the app's tests (`npm test` in `app/host`), the Terminal tests and the server's tests. Saving a control vector and then loading a model puts the four control vector flags in the arguments the engine is started with. A vector file that does not exist stops the load with a plain message. Turning the vector off removes the flags and they do not come back on the next save.
- Every new screen text is translated into all eleven app languages.

## What we did not test

- This release on GeForce NOW.
- A real engine loading a control vector from these settings. The engine prints a line starting with `strata generate: control vector mode =` when it loads one; that line has not been seen with this release yet.
- The `add` mode and the `single` direction with a real model.

## Updating

- Install the new installer from https://github.com/0BlueYan0/GFN-Strata/releases over the old one.
- The in-app updater does not install the app or Control. The engine is still offered by the in-app updater and by `strata update`.

## Downloads

One Windows installer, `Strata-0.2.16-windows-x64-setup.exe`. It is not signed.
