# Simple Discord Community Bot

A neutral, multi-server Discord bot with only these features:

- Two-group role verification with configurable labels and optional pending roles
- USD and GBP tribute logging and member totals
- Private Verification, Support, and Other tickets with transcripts
- Separate sticky notes in multiple channels
- Built-in, custom, and reaction-signup animated wheels

It has no games, GIF search, QOTD, confessions, reaction roles, logging system, custom replies, or welcome system. Each Discord server has separate roles, channels, tribute records, tickets, sticky notes, and wheels.

## Discord setup

1. Create an application at <https://discord.com/developers/applications>.
2. Copy the **Application ID** for `CLIENT_ID`.
3. Open **Bot**, reset/copy the token for `DISCORD_TOKEN`, and enable:
   - Server Members Intent
   - Message Content Intent
4. Under **Installation**, enable `bot` and `applications.commands`.
5. Give the bot:
   - View Channels
   - Send Messages
   - Embed Links
   - Attach Files
   - Add Reactions
   - Read Message History
   - Manage Roles
   - Manage Channels
6. Enable **Public Bot** if other server owners should be able to install it.
7. Copy the installation link and share it with server owners who want to add the bot.

Do not put the bot token in GitHub or share it in Discord.

## Railway setup

1. Upload this project's files to the root of a private GitHub repository.
2. Create a Railway project from that repository.
3. Add a Railway volume to the bot service and mount it at `/data`.
4. Add these Railway variables:

```text
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_application_id
DATABASE_PATH=/data/community-bot.sqlite
```

5. Deploy. The logs should show:

```text
Database ready at /data/community-bot.sqlite
Connected as YourBotName
Registered 6 global commands
```

Discord may take a little time to display newly registered global commands in every server.

## Server configuration

An administrator runs these separately in each server:

1. `/setup roles`
2. `/setup tributes`
3. `/setup tickets`
4. `/setup show`
5. `/ticket panel`

Move the bot's Discord role above every pending or verified role it manages.

## Available commands

### Verification

- `/verify group-one`
- `/verify group-two`

### Tributes

- `/tribute log`
- `/tribute totals`

Tribute totals keep USD and GBP separate and also show converted USD using £1 = $1.27.

### Tickets

- `/ticket panel`
- `/ticket open`
- `/ticket transcript`
- `/ticket close`

Only the configured moderator role or members with Manage Server can create transcripts or close/delete tickets. Closing saves a final transcript before deleting the ticket channel.

### Sticky notes

- `/sticky set`
- `/sticky show`
- `/sticky remove`

Each channel can have a different sticky note.

### Wheels

- `/wheel spin`
- `/wheel list`
- `/wheel create`
- `/wheel delete`
- `/wheel reaction-open`
- `/wheel run`
- `/wheel reaction-cancel`

Built-in wheels are Small, Medium, Large, and Group Two. The Group Two wheel uses members who currently have the configured verified Group Two role.

## Updating later

Replace the code files in the same GitHub repository and commit the update. Railway will redeploy automatically. Keep the same Railway service, variables, and `/data` volume so saved settings and records remain intact.
