# Mirli in Discord

A bot that brings one of your Mirli characters into a Discord voice channel. People talk, the character answers in
its own voice, and speaking over it interrupts it. It joins under the character's name.

It is a client of Mirli's live voice calls, like the **Calls** page in the app (see [live/README.md](../../live/README.md)):
the Mirli server grants the call (the character's persona and voice, a socket and a token) and the bot streams the
channel's audio to the live voice worker.

```
Discord voice (Opus, one stream per user)
  -> decode -> 48 kHz stereo -> 16 kHz mono, 512-sample frames every 32 ms
  -> live voice worker /ws   (VAD -> speech-to-text -> LLM -> streaming TTS)
  <- 48 kHz mono PCM, `flush` on barge-in
  -> Discord (raw PCM -> Opus)
```

## Set up

You need Mirli and the live voice worker running on the same machine as the bot (see [live/README.md](../../live/README.md)),
and Node 22.12 or newer.

1. **Make the bot.** At the [Discord developer portal](https://discord.com/developers/applications), create an
   application, open **Bot**, and reset and copy its token. No privileged intents are needed. Under **Installation**,
   set the install link to *None* if you want to turn **Public Bot** off, so only you can add it.
2. **Invite it** with this URL, putting your application id in it:
   `https://discord.com/oauth2/authorize?client_id=<application id>&scope=bot+applications.commands&permissions=103810048`.
   That is **View Channel**, **Connect**, **Speak**, **Use Voice Activity** and **Change Nickname** (for showing the
   character's name).
3. **Set the environment.** The token is only ever read from the environment, never from a file in the repo. On
   Windows, user environment variables keep it across terminals:

```powershell
[Environment]::SetEnvironmentVariable("DISCORD_TOKEN", "<bot token>", "User")
```

```powershell
[Environment]::SetEnvironmentVariable("DISCORD_APP_ID", "<application id>", "User")
```

```powershell
[Environment]::SetEnvironmentVariable("DISCORD_GUILD_ID", "<your server id>", "User")
```

   Open a new terminal afterwards so it sees them. `DISCORD_GUILD_ID` is optional: with it the commands appear in that
   server at once; without it they are registered globally, which can take an hour.

4. **Register the commands once, then start the bot:**

```powershell
cd integrations/discord
```

```powershell
npm install
```

```powershell
npm run register
```

```powershell
npm start
```

It prints `signed in as <bot>; Mirli at http://127.0.0.1:17494` and how many characters and voices it found.

## Use it

Join a voice channel, then:

| Command | What it does |
| --- | --- |
| `/mirli join character:<name> voice:<name>` | Join your channel as a character (autocomplete lists your Mirli characters). Both options are optional: no character is Mirli itself; `voice:` overrides the character's voice. |
| `/mirli character name:<name>` | Switch character mid-call. The conversation starts fresh. |
| `/mirli voice name:<name>` | Change the voice mid-call (autocomplete lists your saved voices). |
| `/mirli persona text:<who they are>` | A one-off persona for this call, in your own words. To keep one, make a character in Mirli (**Calls > New character**). |
| `/mirli say text:<words>` | Answer typed text out loud, as if it was spoken. |
| `/mirli reset` | Forget the conversation so far. |
| `/mirli leave` | Leave the channel and end the call. |

Typing a name instead of picking from the list works too. The commands default to members with **Manage Server**,
because every call spends the host's GPU; change that under Server Settings > Integrations.

Characters are made and edited in Mirli, and the bot sees the same list as the app. While a Discord call runs, the app
can't start another one (one call per machine), and the other way round.

## Who it listens to

The live voice worker holds one conversation, so the bot listens to **one person at a time**. The first person to speak
has the floor until they have been quiet for `FLOOR_HOLD_MS`; everyone else is ignored meanwhile. The floor is free
while the character is talking, so anyone who speaks over it takes the floor and the worker's barge-in stops the
reply. Mixing several people into one stream would garble the transcript, so it doesn't.

The bot leaves, and ends the call, when the last person leaves the channel.

## Settings

| Variable | Default | |
| --- | --- | --- |
| `DISCORD_TOKEN`, `DISCORD_APP_ID` | required | The bot's token and application id. |
| `DISCORD_GUILD_ID` | unset | Register the commands in one server instead of globally. |
| `MIRLI_URL` | `http://127.0.0.1:17494` | The Mirli server (characters, voices, call grants). |
| `MIRLI_CHARACTER` | unset | A character (id or name) for `/mirli join` without `character:`. |
| `DISCORD_ALLOWED_USERS` | unset | Comma-separated Discord user ids the character listens to. Unset means anyone in the channel. |
| `FLOOR_HOLD_MS` | `1200` | How long someone keeps the floor after they stop talking. |
| `MIRLI_DISCORD_NICKNAME` | on | `off` keeps the bot's own name instead of the character's. |

## Answering with your own Claude

Start the worker with `LLM_PROVIDER=claude` and the characters answer with your signed-in Claude Code, no API key
(see [live/voice/README.md](../../live/voice/README.md)). Your CLAUDE.md, memory, tools and MCP servers are all off for
it, so nothing private reaches the channel. Everyone in the channel is then talking to your Claude subscription:
check Anthropic's terms for your plan, and set `DISCORD_ALLOWED_USERS` to people you trust.

## What is verified

- **By the tests (`npm test`):** the audio conversion, the floor, the whole bridge against a stand-in worker, the Call
  API client (busy, unreachable, character switch) and the call token in the socket's subprotocols.
- **By hand:** an earlier version of this bot, talking to the worker directly, joined a real Discord voice channel
  (DAVE end-to-end encryption negotiated) and switched voice. The version on the Call API has not joined a real
  channel yet.
- **Not promised by Discord:** receiving audio as a bot is undocumented, so `@discordjs/voice` can't promise it stays
  stable. Discord requires DAVE for voice; `@snazzah/davey` provides it.

## Limits

- One call per machine (Mirli's rule), and one call per Discord server.
- The 48 kHz to 16 kHz step averages three samples: fine for speech recognition, not meant for music.
- Barge-in is judged from the floor holder's audio only.
- After a barge-in, the conversation history keeps the whole generated reply, not just the part that was heard.
