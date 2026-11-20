/**
 * Recognise e-book containers the importer can't read, and say why: DRM, or
 * a Kindle format that isn't supported.
 *
 *  - MOBI / AZW / AZW3 (KF8): a Palm database whose type/creator at byte 60
 *    is "BOOKMOBI". Record 0 starts with the PalmDOC header, whose
 *    encryption field (offset 12) is 0 for none, 1 or 2 for Mobipocket DRM.
 *  - KFX: Amazon's container, magic "CONT" at byte 0 (or a zip of .kfx parts).
 *  - EPUB DRM: Adobe ADEPT (META-INF/rights.xml), Apple FairPlay
 *    (META-INF/sinf.xml), Readium LCP (META-INF/license.lcpl), or
 *    META-INF/encryption.xml encrypting content documents. Font obfuscation
 *    (IDPF or Adobe algorithm on font files) is not DRM and is allowed.
 *
 * References: MobileRead wiki, "PDB" and "MOBI" format pages; EPUB OCF 3.3 §4.2.6
 * (encryption.xml) and §4.2.6.3 (font obfuscation).
 */

export type KindleKind = "mobi" | "kfx";

export interface KindleInfo {
  kind: KindleKind;
  encrypted: boolean;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

/** A MOBI/AZW/AZW3 or KFX file, with whether it is DRM-locked; null otherwise. */
export function sniffKindle(bytes: Uint8Array): KindleInfo | null {
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === "CONT") return { kind: "kfx", encrypted: true };
  if (bytes.length < 86 || ascii(bytes, 60, 8) !== "BOOKMOBI") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const recordCount = view.getUint16(76);
  if (recordCount < 1) return { kind: "mobi", encrypted: false };
  const record0 = view.getUint32(78);
  const encryption = record0 + 14 <= bytes.length ? view.getUint16(record0 + 12) : 0;
  return { kind: "mobi", encrypted: encryption !== 0 };
}

const FONT_OBFUSCATION = [
  "http://www.idpf.org/2008/embedding",
  "http://ns.adobe.com/pdf/enc#RC",
];

/** Why an EPUB is DRM-locked, or null when it isn't. `files` maps zip paths
 *  (any case) to text, only for the META-INF entries asked for. */
export function epubDrm(read: (path: string) => string | null): string | null {
  if (read("META-INF/rights.xml") !== null) return "Adobe DRM";
  if (read("META-INF/sinf.xml") !== null) return "Apple FairPlay DRM";
  if (read("META-INF/license.lcpl") !== null) return "Readium LCP DRM";
  const enc = read("META-INF/encryption.xml");
  if (!enc) return null;
  // Each EncryptedData names an algorithm and a target file.
  for (const block of enc.split(/<(?:\w+:)?EncryptedData\b/).slice(1)) {
    const algorithm = /Algorithm\s*=\s*["']([^"']+)["']/.exec(block)?.[1] ?? "";
    const target = /URI\s*=\s*["']([^"']+)["']/.exec(block)?.[1] ?? "";
    if (FONT_OBFUSCATION.includes(algorithm)) continue;
    if (/\.(?:otf|ttf|woff2?|pfb)$/i.test(target)) continue;
    return "encrypted content";
  }
  return null;
}

export function kindleMessage(info: KindleInfo): string {
  if (info.kind === "kfx") {
    return "This is a Kindle KFX book. KFX files are DRM-protected and can't be imported. Use an EPUB, PDF or Word copy of the book instead.";
  }
  if (info.encrypted) {
    return "This Kindle book (MOBI/AZW) is DRM-protected, so its text can't be read. Use a DRM-free copy of the book instead.";
  }
  return "Kindle MOBI/AZW3 files aren't supported yet. Convert the book to EPUB (for example with Calibre) and import that.";
}
