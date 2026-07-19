<div align="center">
  <h1>🎵 Discord Music Bot</h1>
  <p>Простой, но мощный музыкальный бот для вашего сервера Discord.</p>
  
  [![Node.js](https://img.shields.io/badge/Node.js-LTS-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
  [![Discord.js](https://img.shields.io/badge/discord.js-latest-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.js.org/)
  [![Discord Player](https://img.shields.io/badge/discord--player-latest-red?style=for-the-badge)](https://discord-player.js.org/)
</div>

---

## 🌟 Особенности
- Воспроизведение музыки из YouTube и других источников.
- Поддержка современных слэш-команд (Slash Commands).
- Легкая настройка и быстрая установка.

## 🛠️ Шаг 1. Установка Node.js
Для запуска этого бота необходим Node.js. 
1. Перейдите на сайт [nodejs.org](https://nodejs.org/).
2. Скачайте и установите версию **LTS** (Recommended for most users).
3. Во время установки оставляйте все галочки по умолчанию (соглашайтесь на установку дополнительных инструментов).

## 🤖 Шаг 2. Получение Токена Бота
1. Перейдите на [Discord Developer Portal](https://discord.com/developers/applications).
2. Нажмите кнопку **New Application** в правом верхнем углу и задайте имя.
3. В меню слева выберите раздел **Bot**.
4. Найдите кнопку **Reset Token** (или **Copy**), чтобы скопировать токен вашего бота. ⚠️ *Никому его не показывайте!*
5. Прокрутите страницу вниз до раздела **Privileged Gateway Intents** и **включите все три галочки** (Presence Intent, Server Members Intent, Message Content Intent), затем сохраните изменения (Save Changes).

## 📥 Шаг 3. Приглашение бота на сервер
1. В левом меню Developer Portal перейдите в раздел **OAuth2** -> **URL Generator**.
2. В блоке "Scopes" поставьте галочки на `bot` и `applications.commands`.
3. В появившемся блоке "Bot Permissions" поставьте галочку `Administrator` (или выберите нужные права вручную: Send Messages, Connect, Speak и т.д.).
4. Скопируйте сгенерированную ссылку в самом низу и откройте ее в браузере. Выберите свой сервер и авторизуйте бота.

## ⚙️ Шаг 4. Настройка проекта
1. В папке с ботом переименуйте файл `.env.example` в `.env`.
2. Откройте файл `.env` любым текстовым редактором.
3. Вставьте свой токен вместо текста `СЮДА_ВСТАВИТЬ_ВАШ_ТОКЕН`.
   Должно получиться примерно так: `DISCORD_TOKEN=OTQ...ваш.длинный.токен`

## 🚀 Шаг 5. Запуск
1. Откройте терминал (или командную строку Windows) в папке с проектом.
2. Выполните команду для установки нужных библиотек:
   ```bash
   npm install
   ```
3. Запустите бота командой:
   ```bash
   npm start
   ```

Если в консоли появится надпись "Бот ... успешно запущен!" и "Слэш-команды успешно зарегистрированы!", значит всё работает. Заходите в голосовой канал и пишите `/play`! 🎉
