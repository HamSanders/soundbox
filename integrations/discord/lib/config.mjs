export const COMMAND_NAME = "mirli";

/** Everything comes from the environment; the bot token is never read from a file in the repo. */
export function loadConfig(env = process.env) {
  const need = (k) => {
    if (!env[k]) throw new Error(`${k} is not set. See integrations/discord/README.md.`);
    return env[k];
  };
  return {
    token: need("DISCORD_TOKEN"),
    appId: need("DISCORD_APP_ID"),
    guildId: env.DISCORD_GUILD_ID ?? "",
    /** The Mirli server: characters, voices and call grants come from its Call API. */
    mirliUrl: env.MIRLI_URL ?? "http://127.0.0.1:17494",
    /** A character (id or name) for calls that don't pick one; empty talks to Mirli itself. */
    defaultCharacter: env.MIRLI_CHARACTER ?? "",
    allow: env.DISCORD_ALLOWED_USERS
      ? new Set(env.DISCORD_ALLOWED_USERS.split(",").map((s) => s.trim()).filter(Boolean))
      : null,
    holdMs: Number(env.FLOOR_HOLD_MS ?? 1200),
    /** Rename the bot to the character in each server ("Change Nickname" permission). */
    nickname: env.MIRLI_DISCORD_NICKNAME !== "off",
  };
}
