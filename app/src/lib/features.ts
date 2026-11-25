/**
 * Features that are built but not shipped yet. Each is off in a normal build
 * and turned on at build time with a `VITE_*` flag, so the code keeps
 * compiling and its tests keep running while nobody can reach it by accident.
 *
 * Calls (live voice calls with characters) are pulled until they are ready:
 * `VITE_CALLS=1` for the app, and `MIRLI_CALLS=1` on the server, which
 * otherwise serves no Call API at all.
 */
export const CALLS_ENABLED = import.meta.env.VITE_CALLS === "1";
