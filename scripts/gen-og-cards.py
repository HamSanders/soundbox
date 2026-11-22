"""Draw the site's share cards (og:image), 1200x630 JPG, into site/public/og/.

    default.jpg  every page that does not name its own card
    mcp.jpg      /mcp, with the one line that connects an agent

Each is a real product screenshot (site/public/product/, taken by
scripts/capture-media.mjs) under the name and one line of copy, set in the
site's own faces from node_modules: Big Shoulders Display for the name, Inter
for the rest. The command on the MCP card uses Consolas when it is installed
(Windows) and Inter otherwise. Re-run after a screenshot or the copy changes:

    node scripts/capture-media.mjs
    python scripts/gen-og-cards.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "public" / "og"
PRODUCT = ROOT / "site" / "public" / "product"
FONTS = ROOT / "node_modules" / "@fontsource-variable"
INTER = FONTS / "inter" / "files" / "inter-latin-wght-normal.woff2"
DISPLAY = FONTS / "big-shoulders-display" / "files" / "big-shoulders-display-latin-wght-normal.woff2"
MONO = Path("C:/Windows/Fonts/consola.ttf")

W, H = 1200, 630
# The dark theme's tokens (`.dark` in app/src/index.css): background, card,
# foreground, muted-foreground, signal and border.
BACKGROUND = (0x18, 0x18, 0x17)
CARD = (0x20, 0x20, 0x1E)
FOREGROUND = (0xF1, 0xEC, 0xE0)
MUTED = (0xA9, 0xA7, 0x97)
SIGNAL = (0xF2, 0xA4, 0x0C)
BORDER = (0x33, 0x33, 0x2F)


def inter(size: int, weight: str) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(str(INTER), size)
    font.set_variation_by_name(weight)
    return font


def display(size: int) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(str(DISPLAY), size)
    font.set_variation_by_name("ExtraBold")
    return font


def mono(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(MONO), size) if MONO.exists() else inter(size, "Regular")


def rounded(im: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius, fill=255)
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out


def card(screenshot: str | None, eyebrow: str, title: str, line: str, command: str | None = None) -> Image.Image:
    im = Image.new("RGB", (W, H), BACKGROUND)
    draw = ImageDraw.Draw(im)

    # The screenshot runs off the bottom-right edge, so it reads as a window
    # behind the copy rather than a thumbnail beside it.
    if screenshot:
        shot = Image.open(PRODUCT / screenshot).convert("RGB")
        shot_w = 760
        shot = shot.resize((shot_w, round(shot.height * shot_w / shot.width)), Image.LANCZOS)
        x, y = W - shot_w + 120, 250
        frame = Image.new("RGB", (shot.width + 2, shot.height + 2), BORDER)
        im.paste(rounded(frame, 18), (x - 1, y - 1), rounded(frame, 18))
        im.paste(rounded(shot, 16), (x, y), rounded(shot, 16))

    left = 72
    draw.text((left, 64), eyebrow, font=inter(26, "SemiBold"), fill=SIGNAL)
    # Headings are set in capitals in the app; the card follows.
    draw.text((left, 100), title.upper(), font=display(84), fill=FOREGROUND)
    body = inter(32, "Regular")
    for i, text in enumerate(line.split("\n")):
        draw.text((left, 206 + i * 42), text, font=body, fill=MUTED)

    if command:
        # The command is the card: one line that connects an agent.
        font = mono(25)
        pad = 24
        prompt_w = round(draw.textlength("$ ", font=font))
        box_w = round(draw.textlength(command, font=font)) + prompt_w + pad * 2
        top = 340
        draw.rounded_rectangle((left, top, left + box_w, top + 84), 14, fill=CARD, outline=BORDER, width=2)
        draw.text((left + pad, top + 27), "$", font=font, fill=SIGNAL)
        draw.text((left + pad + prompt_w, top + 27), command, font=font, fill=FOREGROUND)
        draw.text(
            (left, top + 112),
            "24 tools · Claude Code, Cursor or any MCP client · no API key",
            font=inter(24, "Regular"),
            fill=MUTED,
        )

    draw.text((left, H - 64), "mirli.app", font=inter(22, "Medium"), fill=MUTED)
    return im


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    cards = {
        "default.jpg": card(
            "app-studio.webp",
            "Open source · MIT",
            "Mirli",
            "Sound effects, music and voices,\ngenerated on your own machine.",
        ),
        "mcp.jpg": card(
            None,
            "MCP server",
            "Mirli for agents",
            "Sound effects, music and speech,\ngenerated locally for your coding agent.",
            command="claude mcp add --transport http soundbox http://127.0.0.1:17494/mcp",
        ),
    }
    for name, im in cards.items():
        path = OUT / name
        im.save(path, "JPEG", quality=85, optimize=True, progressive=True)
        print(f"{path.relative_to(ROOT)}: {path.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
