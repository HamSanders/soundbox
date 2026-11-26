// Mirli for Discord: /mirli join puts a Mirli character in your voice channel. The character, its persona and
// voice come from the Mirli server's Call API (the same calls the app's Calls page makes); the audio streams to
// the live voice worker. It listens to one person at a time. See README.md.

import { PassThrough } from "node:stream";

import {
  AudioPlayerStatus,
  EndBehaviorType,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from "@discordjs/voice";
import { Client, GatewayIntentBits, MessageFlags } from "discord.js";
import OpusScript from "opusscript";

import { bytesToInt16 } from "./lib/audio.mjs";
import { COMMAND_NAME, loadConfig } from "./lib/config.mjs";
import { Floor } from "./lib/floor.mjs";
import { LiveSocket } from "./lib/live.mjs";
import { applyGrant, cached, choices, mirliClient, resolveId, setVoice } from "./lib/mirli.mjs";
import { CallSession } from "./lib/session.mjs";

const cfg = loadConfig();
const mirli = mirliClient(cfg.mirliUrl);
const getVoices = cached(() => mirli.voices());
const getCharacters = cached(() => mirli.characters());
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
/** guildId -> { grant, connection, live, player, session, channel, close() } */
const calls = new Map();

/** Raw 48 kHz stereo PCM into an AudioPlayer. The stream stays open across sentences and is replaced when the player idles. */
function makeOut(player, onIdle) {
  let stream = null;
  player.on(AudioPlayerStatus.Idle, () => {
    stream?.destroy();
    stream = null;
    onIdle();
  });
  return {
    write(bytes) {
      if (!stream) {
        stream = new PassThrough();
        player.play(createAudioResource(stream, { inputType: StreamType.Raw }));
      }
      stream.write(bytes);
    },
    flush() {
      stream?.destroy();
      stream = null;
      player.stop(true);
    },
  };
}

/** The bot shows up in the member list under the character's name. Needs "Change Nickname"; skipped without it. */
async function nickname(guild, name) {
  if (!cfg.nickname) return;
  try {
    await guild.members.me?.setNickname(name ? name.slice(0, 32) : null);
  } catch (e) {
    console.error(`nickname: ${e.message} (give the bot "Change Nickname", or set MIRLI_DISCORD_NICKNAME=off)`);
  }
}

/** "as Santa in the voice Brit", for replies. */
function describe(name, r) {
  return `**${name}**${r.voiceName ? ` in the voice **${r.voiceName}**` : ""}${r.voiceError ? ` (voice not set: ${r.voiceError})` : ""}`;
}

async function join(interaction) {
  const channel = interaction.member?.voice?.channel;
  if (!channel) return interaction.editReply("Join a voice channel first, then run this again.");
  if (calls.has(interaction.guildId)) {
    return interaction.editReply("I'm already in a voice channel here. Run `/mirli leave` first.");
  }

  // The call first: if Mirli can't take it (busy, worker down), don't touch the voice channel.
  const wantedCharacter = interaction.options.getString("character") || cfg.defaultCharacter || null;
  let grant;
  try {
    grant = await mirli.startCall(wantedCharacter);
  } catch (e) {
    return interaction.editReply(`Mirli couldn't start a call: ${e.message}`);
  }
  const hangUp = () => mirli.endCall(grant.call_id).catch(() => {});

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false, // receiving audio needs the bot undeafened
  });
  // Discord can destroy the connection under us; destroying twice throws.
  const safeDestroy = () => {
    if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
  };
  connection.on("stateChange", (o, n) => {
    const why = [n.reason !== undefined && `reason=${n.reason}`, n.closeCode && `closeCode=${n.closeCode}`].filter(Boolean).join(" ");
    console.log(`voice: ${o.status} -> ${n.status} ${why}`.trim());
  });
  connection.on("error", (e) => console.error("voice error:", e.message));
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch {
    safeDestroy();
    await hangUp();
    return interaction.editReply("Couldn't connect to the voice channel in time.");
  }

  const player = createAudioPlayer();
  connection.subscribe(player);
  const floor = new Floor({ holdMs: cfg.holdMs, allow: cfg.allow });
  let session;
  const live = new LiveSocket(grant.ws_url, () => session.source(), { token: grant.token });
  live.on("error", (e) => console.error("live:", e.message)); // also the worker's own {type:"error"} messages
  const out = makeOut(player, () => session?.playbackEnded());
  session = new CallSession({ live, floor, out });

  // Heartbeats keep the call alive on the Mirli server; a missed run of them ends it.
  const beat = setInterval(() => mirli.heartbeat(grant.call_id).catch((e) => console.error("heartbeat:", e.message)), grant.heartbeat_s * 1000);
  const close = () => {
    if (!calls.delete(interaction.guildId)) return;
    clearInterval(beat);
    live.close();
    player.stop(true);
    safeDestroy();
    void hangUp();
    void nickname(channel.guild, null);
  };
  const call = { grant, connection, live, player, session, channel, close };

  try {
    const hello = await live.connect();
    if (hello.tts?.sample_rate !== 48000) {
      throw new Error(`the live voice worker speaks ${hello.tts?.sample_rate} Hz and Discord needs 48000`);
    }
  } catch (e) {
    clearInterval(beat);
    player.stop(true);
    safeDestroy();
    await hangUp();
    return interaction.editReply(`Couldn't reach the live voice worker: ${e.message}`);
  }
  calls.set(interaction.guildId, call);
  const voiceOption = interaction.options.getString("voice");
  const r = await applyGrant(live, grant, voiceOption ? resolveId(await getVoices().catch(() => []), voiceOption) : null);
  void nickname(channel.guild, grant.name);

  live.on("close", close);
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      close();
    }
  });

  // One subscription per user while they speak; each Opus packet is decoded and handed to the session.
  const subscribed = new Set();
  connection.receiver.speaking.on("start", (userId) => {
    if (subscribed.has(userId) || client.users.cache.get(userId)?.bot) return;
    subscribed.add(userId);
    const decoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
    const opus = connection.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 400 },
    });
    opus.on("data", (packet) => {
      try {
        session.onUserAudio(userId, bytesToInt16(decoder.decode(packet)));
      } catch {
        /* a corrupt packet is one lost 20 ms */
      }
    });
    const done = () => {
      subscribed.delete(userId);
      decoder.delete();
    };
    opus.once("end", done);
    opus.once("error", done);
  });

  return interaction.editReply(`Joined **${channel.name}** as ${describe(grant.name, r)}. Talk to me. I listen to one person at a time.`);
}

client.on("interactionCreate", async (i) => {
  if (i.isAutocomplete() && i.commandName === COMMAND_NAME) {
    // Characters for join character: and character name:, voices for join voice: and voice name:.
    try {
      const focused = i.options.getFocused(true);
      const forCharacters = focused.name === "character" || i.options.getSubcommand(false) === "character";
      await i.respond(choices(forCharacters ? await getCharacters() : await getVoices(), focused.value));
    } catch (e) {
      console.error("autocomplete:", e.message);
      await i.respond([]).catch(() => {});
    }
    return;
  }
  if (!i.isChatInputCommand() || i.commandName !== COMMAND_NAME || !i.guildId) return;
  const sub = i.options.getSubcommand();
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (sub === "join") return await join(i);
    const call = calls.get(i.guildId);
    if (!call) return await i.editReply("I'm not in a voice channel here.");
    if (sub === "character") {
      const wanted = i.options.getString("name", true);
      let sw;
      try {
        sw = await mirli.setCharacter(call.grant.call_id, wanted);
      } catch (e) {
        return await i.editReply(`Couldn't switch: ${e.message}`);
      }
      const r = await applyGrant(call.live, sw);
      void nickname(call.channel.guild, sw.name);
      return await i.editReply(`Now ${describe(sw.name, r)}. The conversation starts fresh.`);
    }
    if (sub === "voice") {
      const r = await setVoice(call.live, resolveId(await getVoices().catch(() => []), i.options.getString("name", true)));
      return await i.editReply(r.error ? `Couldn't switch voice: ${r.error}` : `Voice is now **${r.name}**.`);
    }
    if (sub === "persona") {
      // A one-off persona for this call; characters you keep are made in Mirli (Calls > New character).
      call.live.control({ type: "persona", text: i.options.getString("text", true) });
      return await i.editReply("Persona set. The conversation starts fresh.");
    }
    if (sub === "leave") {
      call.close();
      return await i.editReply("Left.");
    }
    if (sub === "reset") {
      call.live.control({ type: "reset" });
      return await i.editReply("Forgot the conversation.");
    }
    if (sub === "say") {
      call.live.control({ type: "text", text: i.options.getString("text", true) });
      return await i.editReply("Sent.");
    }
  } catch (e) {
    console.error(e);
    await i.editReply("Something went wrong. Check the bot's log.").catch(() => {});
  }
});

// If everyone else leaves, don't keep the call open.
client.on("voiceStateUpdate", (oldState) => {
  const call = calls.get(oldState.guild.id);
  if (call && call.channel.members.filter((m) => !m.user.bot).size === 0) call.close();
});

client.once("clientReady", () => {
  console.log(`signed in as ${client.user.tag}; Mirli at ${mirli.base}`);
  Promise.all([getCharacters(), getVoices()]).then(
    ([c, v]) => console.log(`${c.length} characters, ${v.length} voices`),
    (e) => console.error("mirli:", e.message),
  );
});
const shutdown = () => {
  for (const c of calls.values()) c.close();
  client.destroy();
  setTimeout(() => process.exit(0), 500); // let the hang-ups reach Mirli
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
await client.login(cfg.token);
