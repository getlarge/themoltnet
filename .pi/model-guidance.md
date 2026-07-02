# Pi model guidance

Repo-local Pi config lives in `.pi/settings.json` and `.pi/models.json`.
Runtime profiles remain the source of truth for execution settings; this file
is only a lightweight operator reference for model selection and sampling.

## Sampling defaults

Leave `temperature`, `topP`, and `topK` unset in runtime profiles unless a
model has provider-published guidance or an eval-specific reason to pin values.
Pinned values should stay in the runtime profile, not hidden in `.pi/models.json`.

| Model family                                        | Recommended sampling                             | Source                                                                          | Notes                                                                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gemma 4 (`gemma4:12b`, `gemma4:31b-cloud`)          | `temperature=1.0`, `topP=0.95`, `topK=64`        | https://ollama.com/library/gemma4:12b                                           | Ollama publishes these as standardized Gemma 4 sampling parameters. Treat `gemma4:31b-cloud` as the cloud Gemma 4 target unless Ollama publishes variant-specific guidance. |
| gpt-oss (`gpt-oss:20b-cloud`, `gpt-oss:120b-cloud`) | `temperature=1.0`; leave `topP` and `topK` unset | https://ollama.com/library/gpt-oss:20b, https://ollama.com/library/gpt-oss:120b | Ollama exposes only temperature in the model params checked.                                                                                                                |
| GLM / Kimi / Qwen / MiniMax / Nemotron              | Leave sampling unset                             | Provider pages and evals                                                        | No blanket sampling default is recorded here. Use task-specific eval evidence before pinning values.                                                                        |

## Thinking levels

For Ollama Cloud models that support thinking, `.pi/models.json` maps MoltNet
runtime-profile thinking levels to the provider values Pi understands. Keep
that mapping in the model registry; keep the selected level in the runtime
profile.

Most Ollama Cloud reasoning-capable models in this repo use:

| MoltNet level | Pi/provider value |
| ------------- | ----------------- |
| `off`         | `none`            |
| `minimal`     | `low`             |
| `low`         | `low`             |
| `medium`      | `medium`          |
| `high`        | `high`            |
| `xhigh`       | `max`             |

`gpt-oss` currently maps only `low`, `medium`, and `high`; `minimal` and `off`
are `null` in `.pi/models.json`.

## Current replacement policy

Do not keep retired Ollama Cloud models in `.pi/settings.json`,
`.pi/models.json`, or production runtime profiles. When Ollama announces a
retirement, prefer the replacement named by Ollama unless we have direct eval
evidence for another target.

Retirement cleanup applied in July 2026:

| Retired model                  | Replacement          |
| ------------------------------ | -------------------- |
| `gemini-3-flash-preview:cloud` | `minimax-m3:cloud`   |
| `glm-4.7:cloud`                | `glm-5.2:cloud`      |
| `glm-5:cloud`                  | `glm-5.2:cloud`      |
| `minimax-m2.1:cloud`           | `minimax-m3:cloud`   |
| `qwen3-coder:480b-cloud`       | `qwen3.5:397b-cloud` |

Production runtime profiles were also moved from `qwen3-coder:480b-cloud` to
`qwen3.5:397b-cloud`.
