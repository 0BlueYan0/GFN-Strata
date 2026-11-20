# control-vector-huihui (EXPERIMENTAL, off by default)

`Huihui-Qwen3.8-Flash-Next-refusal-direction-r.gguf` is a 480 KB control vector for Qwen3.8-Flash-Next: one unit
direction of 2,560 values per layer (`direction.1` .. `direction.47`, GGUF `controlvector` format). It is a second
choice next to `../experimental-speed-projection/`: the two files hold different directions in every layer.

**What it does.** Turned on, Strata removes each direction from the residual stream after the chosen layers
(`h -= (h . v) v`, `--cvec-mode project`). The direction is a **refusal direction**: the model declines far fewer
requests, and removing refusals removes a safety behaviour. You are responsible for what the model writes with it on.

**Turning it on.** In the app, open the model page, turn on Expert mode, and use "Control vector" (choose "Huihui
(alesha-pro)", save, load the model again). In a model's settings file it is these options:

```text
--control-vector-scaled <path>/Huihui-Qwen3.8-Flash-Next-refusal-direction-r.gguf:1.0
--control-vector-layer-range 4 44 --cvec-mode project --cvec-dir per-layer
```

**Origin.**

| | |
|---|---|
| File | `Huihui-Qwen3.8-Flash-Next-refusal-direction-r.gguf`, 483,520 bytes |
| SHA-256 | `59f9ae8b4372107ae79044278a4406bdfe8f8861fe599aa5848515f0d072be38` |
| Made by | alesha-pro, published in `alesha-pro/Qwen3.8-Flash-Next-abliterated-GSQ-RCO-Strata-GGUF` on Hugging Face |
| Direction taken from | the weights of `huihui-ai/Huihui-Qwen3.8-Flash-Next-abliterated` (huihui-ai) |
| License | Qwen Community License 1.0, the `LICENSE` file in this folder |

The author's settings are layers 4-44, project mode, one direction per layer, strength 1.0. In the author's words:
"I tested layers 4-44 and 1-47." "I did not test Q2_0 or IQ3_XXS, harder refusal sets, real photos or documents in
vision, more than one GPU, or AMD cards." "Ten prompts is a small set." The measurements are on the model card of that
repository, not measured here.

Made for the original Qwen3.8-Flash-Next (not Swift 1.5).
