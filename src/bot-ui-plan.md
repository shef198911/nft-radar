# Telegram Bot UI Redesign

## Goal
Implement a high-quality, button-driven (Inline Keyboard) Telegram Bot UI for managing OpenSea price alerts, replacing the text-command-based MVP.

## Callback Actions
- `home`: Shows the main menu `[ ➕ Добавить трек ]`, `[ 📋 Мои коллекции ]`.
- `track_add`: Prompts for a link. State -> `WAITING_LINK`.
- `track_list`: Lists all tracked collections as inline buttons `[ Collection Name ]`, plus `[ ➕ Добавить ]`, `[ 🏠 На главную ]`.
- `track_view:<id>`: Shows details for a specific track. Buttons: `[ ✏️ Изменить порог ]`, `[ 🗑 Удалить ]`, `[ 🔙 Назад ]`.
- `track_edit_thr:<id>`: Prompts for a new threshold (percent or abs). State -> `WAITING_EDIT_THRESHOLD`, `state_data` -> `<id>`.
- `track_del:<id>`: Deletes the track and returns to `track_list`.

## State Handling
- `WAITING_LINK`: Expects OpenSea link.
- `WAITING_THRESHOLD`: Expects threshold value.
- `WAITING_EDIT_THRESHOLD`: Expects new threshold value for an existing track.

## Message Handling
- All bot replies will use `reply_markup` with `inline_keyboard`.
- `handleTelegramWebhook` will intercept both `message` and `callback_query`.
- For `callback_query`, we will use `editMessageText` (or delete + send) to make the UI feel like an SPA.
