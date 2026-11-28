/**
 * eSpeak-ng for the audio.cpp families that phonemise through it (Kokoro,
 * KittenTTS).
 *
 * audio.cpp loads eSpeak-ng as a shared library at request time and its
 * releases do not include one. On macOS and Linux its loader searches the
 * usual library directories itself. On Windows it only finds the DLL through
 * the ordinary DLL search, which means the eSpeak NG folder has to be on PATH.
 * Measured with audio.cpp 0.9.6: with `C:\Program Files\eSpeak NG` on PATH a
 * Kokoro read works; with the same install off PATH it fails with "Could not
 * load eSpeak-ng". A server started before eSpeak NG was installed has the old
 * PATH, so it is in the second case until it restarts. audio.cpp reads two
 * environment variables that bypass the search, `AUDIOCPP_ESPEAK_LIBRARY` and
 * `AUDIOCPP_ESPEAK_DATA`, so this module finds the default Windows install and
 * hands it over through them.
 *
 * Anything the user set themselves wins: both variables are left alone when
 * the library one is already present.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

export const ESPEAK_LIBRARY_ENV = "AUDIOCPP_ESPEAK_LIBRARY";
export const ESPEAK_DATA_ENV = "AUDIOCPP_ESPEAK_DATA";

/** The folder the eSpeak NG Windows installer creates under Program Files. */
const WINDOWS_INSTALL_DIR = "eSpeak NG";

export interface EspeakInstall {
  library: string;
  data: string;
}

/**
 * A Windows eSpeak NG install, or null. Both the DLL and its data folder must
 * be there: audio.cpp needs the pair, and a library pointed at missing data
 * fails later with a less useful message.
 */
export function findEspeak(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = existsSync,
): EspeakInstall | null {
  if (platform !== "win32") return null;
  const roots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.ProgramW6432].filter(
    (root): root is string => Boolean(root),
  );
  for (const root of new Set(roots)) {
    const dir = join(root, WINDOWS_INSTALL_DIR);
    const library = join(dir, "libespeak-ng.dll");
    const data = join(dir, "espeak-ng-data");
    if (exists(library) && exists(join(data, "phontab"))) return { library, data };
  }
  return null;
}

/**
 * The environment an audio.cpp child should run with: the parent's, plus the
 * eSpeak-ng location when one was found and the user has not chosen their own.
 */
export function withEspeakEnv(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = existsSync,
): NodeJS.ProcessEnv {
  if (env[ESPEAK_LIBRARY_ENV]) return env;
  const found = findEspeak(env, platform, exists);
  if (found === null) return env;
  return {
    ...env,
    [ESPEAK_LIBRARY_ENV]: found.library,
    [ESPEAK_DATA_ENV]: env[ESPEAK_DATA_ENV] || found.data,
  };
}

const INSTALL_HINT: Partial<Record<NodeJS.Platform, string>> = {
  win32:
    "Install eSpeak NG from https://github.com/espeak-ng/espeak-ng/releases " +
    "(the .msi, into its default folder), then try again.",
  darwin: "Install it with `brew install espeak-ng`, then try again.",
  linux:
    "Install it with your package manager (for example `sudo apt install espeak-ng`), " +
    "then try again.",
};

/**
 * What to tell someone when audio.cpp's output shows eSpeak-ng could not be
 * used, or null when the output is about something else. Matches the errors
 * audio.cpp's phonemiser raises for a missing or broken install.
 */
export function explainEspeakFailure(
  output: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (
    !/Could not load eSpeak-ng|eSpeak-ng library does not exist|Expected an espeak-ng-data directory|eSpeak-ng failed to initialize/i.test(
      output,
    )
  ) {
    return null;
  }
  const hint =
    INSTALL_HINT[platform] ?? "Install eSpeak-ng for your system, then try again.";
  return (
    "This model needs eSpeak-ng to turn text into phonemes, and audio.cpp could not " +
    `use one. ${hint} If it is installed somewhere unusual, set ${ESPEAK_LIBRARY_ENV} ` +
    `to the library file and ${ESPEAK_DATA_ENV} to its espeak-ng-data folder.`
  );
}
