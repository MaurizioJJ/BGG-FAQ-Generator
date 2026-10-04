# Privacy

BGG FAQ Generator v2 does not include analytics, advertising, telemetry, or an application-operated server.

## Data stored in Chrome

Complete scrape datasets, FAQ output, progress checkpoints, and settings are stored locally in the extension's browser storage. Anthropic, OpenAI, and Gemini API keys are stored in memory-backed `chrome.storage.session` unless **Remember my AI API keys** is enabled, in which case they are also stored unencrypted in `chrome.storage.local` in the Chrome profile. If **Remember my BGG token** is enabled, the BGG application token is stored there too. Disabling either option or choosing **Clear credentials** removes the stored values.

Anyone with access to an unlocked browser profile or its extension debugging tools may be able to inspect locally stored data. Clear credentials before sharing a browser profile.

## Network requests

The extension connects only to hosts declared in `manifest.json`:

- `boardgamegeek.com` to search for games and retrieve XML API forum data.
- `api.anthropic.com` when the user explicitly requests FAQ generation.
- `api.openai.com` when the user selects OpenAI and explicitly requests FAQ generation.
- `generativelanguage.googleapis.com` when the user selects Gemini and explicitly requests FAQ generation.

When FAQ generation is confirmed, selected forum posts and the user's optional generation instructions are sent only to the selected provider. OpenAI response storage and paid prompt-cache writes are disabled. The extension displays a provider-specific consent notice before enabling generation. Users are responsible for complying with BoardGameGeek and the selected provider's terms and for verifying generated output.

## Downloads

Text, JSON, Markdown, HTML, and backup files are created only after an explicit user action and are saved using Chrome's normal download behavior.
