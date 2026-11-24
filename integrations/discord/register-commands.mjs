// Registers /mirli. With DISCORD_GUILD_ID set it is per-server (instant); otherwise global (can take an hour).
// Commands are restricted to members with Manage Server by default, because they spend the host's GPU.

import { PermissionFlagsBits, REST, Routes, SlashCommandBuilder } from "discord.js";

import { COMMAND_NAME, loadConfig } from "./lib/config.mjs";

const cfg = loadConfig();
const cmd = new SlashCommandBuilder()
  .setName(COMMAND_NAME)
  .setDescription("Talk live with a Mirli character in your voice channel")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(0)
  .addSubcommand((s) =>
    s
      .setName("join")
      .setDescription("Join the voice channel you are in")
      .addStringOption((o) => o.setName("character").setDescription("Who to bring: a character from Mirli").setAutocomplete(true))
      .addStringOption((o) => o.setName("voice").setDescription("Speak with another saved voice").setAutocomplete(true)),
  )
  .addSubcommand((s) =>
    s
      .setName("character")
      .setDescription("Switch character mid-call (the conversation starts fresh)")
      .addStringOption((o) => o.setName("name").setDescription("A character from Mirli").setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((s) =>
    s
      .setName("voice")
      .setDescription("Change the voice mid-call")
      .addStringOption((o) => o.setName("name").setDescription("A saved Mirli voice").setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((s) =>
    s
      .setName("persona")
      .setDescription("A one-off persona for this call, in your own words (the conversation starts fresh)")
      .addStringOption((o) =>
        o.setName("text").setDescription("e.g. A sarcastic pirate who loves tea").setRequired(true).setMaxLength(1500),
      ),
  )
  .addSubcommand((s) => s.setName("leave").setDescription("Leave the voice channel"))
  .addSubcommand((s) => s.setName("reset").setDescription("Forget the conversation so far"))
  .addSubcommand((s) =>
    s
      .setName("say")
      .setDescription("Answer typed text out loud, as if it was spoken")
      .addStringOption((o) => o.setName("text").setDescription("What to say to the character").setRequired(true).setMaxLength(500)),
  );

const rest = new REST().setToken(cfg.token);
const route = cfg.guildId ? Routes.applicationGuildCommands(cfg.appId, cfg.guildId) : Routes.applicationCommands(cfg.appId);
await rest.put(route, { body: [cmd.toJSON()] });
console.log(`registered /${COMMAND_NAME} ${cfg.guildId ? `in guild ${cfg.guildId}` : "globally"}`);
