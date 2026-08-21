# OpenAI OAuth 1M for OpenCode

An OpenCode 1.x plugin that raises the resolved context limit for GPT-5.6 Sol, Terra, and Luna when using the built-in ChatGPT OAuth transport.

## Quick Start with an AI agent

Paste this prompt into your AI agent:

```text
Install and configure openai-oauth-1m: https://raw.githubusercontent.com/syamsudotdev/openai-oauth-1m/refs/heads/main/README.md
```

## Requirements

- OpenCode 1.18.19 or later
- A working ChatGPT OAuth login in OpenCode

## Install from source

```sh
git clone git@github.com:syamsudotdev/openai-oauth-1m.git
mkdir -p ~/.config/opencode/plugins
cp openai-oauth-1m/openai-oauth-1m.js ~/.config/opencode/plugins/
printf '{\n  "context": 1050000\n}\n' > ~/.config/opencode/openai-oauth-1m.json
```

Restart OpenCode. It loads the plugin automatically from the global plugin directory.

Verify the resolved limits:

```sh
opencode models openai --verbose
```

The maximum supported `context` value is `1050000`. Set it to `0` to disable the override.

## Uninstall

```sh
rm ~/.config/opencode/plugins/openai-oauth-1m.js
rm ~/.config/opencode/openai-oauth-1m.json
```

## License

MIT
