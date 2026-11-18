/**
 * README, "Compared with a hosted service", row for row. Shared by the home
 * page and the search landing pages so the two can never disagree.
 *
 * It describes hosted services in general. Nothing here states what a named
 * competitor charges or allows; nobody has checked that.
 */

export const COMPARISON_HEAD = ["Hosted (ElevenLabs, Suno and similar)", "Soundbox"] as const;

export const COMPARISON: readonly [row: string, hosted: string, ours: string][] = [
  ["Runs on", "Their GPUs", "Your machine"],
  ["Cost", "Subscription or credits", "Your electricity"],
  ["Account", "Required", "None"],
  ["Models", "Closed, tuned, consistent", "Open weights; quality varies by model"],
  ["Output rights", "Their terms of service", "The licence of the model that made it, shown up front"],
  ["Offline", "No", "Yes, once the weights are downloaded"],
  ["Agents", "HTTP API", "HTTP API and an MCP server"],
  ["Source", "Closed", "MIT"],
];
