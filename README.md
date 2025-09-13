# 🛡️ Anti-Mention Guard Bot

A Discord.js v14 bot to protect VIP roles from being pinged.

## ✨ Features
- Block mentions of protected roles or members with those roles
- Timeout offenders automatically
- Keep track of warns (/warnings show/reset)
- Log actions to a channel
- Allow bypass roles

## 🚀 Setup

1. Clone this repo  
   ```bash
   git clone https://github.com/YOUR_USERNAME/anti-mention-guard-bot.git
   cd anti-mention-guard-bot
   ```

2. Install dependencies  
   ```bash
   npm install
   ```

3. Copy `.env.example` → `.env` and fill in:  
   - `DISCORD_TOKEN`
   - `GUILD_ID`
   - `DELETE_OFFENDING_MESSAGES`

4. Run the bot  
   ```bash
   npm start
   ```

## ⚡ Slash Commands
- `/protect-role add/remove/list`
- `/bypass-role add/remove/list`
- `/anti-mention set-delete/set-timeout/set-logs/show`
- `/warnings show/reset`

## 📜 License
MIT