# Datacom_BE

## LINE Chatbot (Integrated)

This project now includes LINE webhook chatbot endpoints in the same Node/Express app.

### Endpoints

- `POST /callback` for LINE Messaging API webhook
- `GET /imagemap/help/:size` for imagemap image resizing (`size` supports: `1040, 700, 460, 300, 240`)

### Required environment variables

- `CHANNEL_ACCESS_TOKEN` or `LINE_CHANNEL_ACCESS_TOKEN`
- `CHANNEL_SECRET` or `LINE_CHANNEL_SECRET`
- `LINE_IMAGEMAP_BASE_URL` (optional, defaults to `https://datacom-chatbot.onrender.com/imagemap/help`)

### Required static asset

- Put `help_menu.png` at `static/help_menu.png`

### Notes

- Current chatbot session state uses in-memory `Map` (will reset on server restart).
- Daily digest push job remains active via `service/lineDigestJob.js`.
