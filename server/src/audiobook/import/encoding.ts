/**
 * Decoding legacy text: a named code page (FB2's XML prolog, RTF's
 * \ansicpg), with Windows-1252 mapped by hand because Node's TextDecoder
 * treats that label as Latin-1 in some builds, turning smart quotes into
 * control codes. Other labels go to TextDecoder; an unknown one falls back
 * to UTF-8, then Windows-1252.
 */

const CP1252 = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

export function decodeWindows1252(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += String.fromCharCode(b >= 0x80 && b <= 0x9f ? CP1252[b - 0x80]! : b);
  return out;
}

/** "1251", "cp1251", "windows-1251", "WINDOWS-1251" → "windows-1251". */
export function normaliseLabel(label: string): string {
  const l = label.trim().toLowerCase();
  const m = /^(?:cp|windows-?|ansi)?(125\d|874)$/.exec(l);
  return m ? `windows-${m[1]}` : l;
}

/** Bytes in a named encoding; UTF-8 (strict) then Windows-1252 if unnamed. */
export function decodeBytes(bytes: Uint8Array, label?: string | null): string {
  const enc = label ? normaliseLabel(label) : null;
  if (enc === "windows-1252" || enc === "iso-8859-1" || enc === "latin1" || enc === "us-ascii") {
    return decodeWindows1252(bytes);
  }
  if (enc && enc !== "utf-8" && enc !== "utf8") {
    try {
      return new TextDecoder(enc).decode(bytes);
    } catch {
      /* unknown label: guess below */
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return decodeWindows1252(bytes);
  }
}
