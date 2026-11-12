"""Draw the site's share cards (og:image), 1200x630 JPG, into site/public/og/.

    default.jpg  every page that does not name its own card
    mcp.jpg      /mcp, with the one line that connects an agent

Each is a real product screenshot (site/public/product/) under the name and one
line of copy, set in Geist from node_modules so the cards match the site. The
command on the MCP card uses Consolas when it is installed (Windows) and Geist
otherwise. Re-run after a screenshot or the copy changes:

    python scripts/gen-og-cards.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "public" / "og"
PRODUCT = ROOT / "site" / "public" / "product"
GEIST = ROOT / "node_modules" / "@fontsource-variable" / "geist" / "files" / "geist-latin-wght-normal.woff2"
MONO = Path("C:/Windows/Fonts/consola.ttf")

W, H = 1200, 630
# The dark theme's tokens (app/src/index.css), converted from oklch.
BACKGROUND = (10, 10, 10)
CARD = (23, 23, 23)
FOREGROUND = (250, 250, 250)
MUTED = (161, 161, 161)
PRIMARY = (0, 178, 186)
BORDER = (40, 40, 40)


def geist(size: int, weight: str) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(str(GEIST), size)
    font.set_variation_by_name(weight)
    return font


def mono(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(MONO), size) if MONO.exists() else geist(size, "Regular")


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
    draw.text((left, 64), eyebrow, font=geist(26, "SemiBold"), fill=PRIMARY)
    draw.text((left, 102), title, font=geist(76, "SemiBold"), fill=FOREGROUND)
    body = geist(32, "Regular")
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
        draw.text((left + pad, top + 27), "$", font=font, fill=PRIMARY)
        draw.text((left + pad + prompt_w, top + 27), command, font=font, fill=FOREGROUND)
        draw.text(
            (left, top + 112),
            "21 tools · Claude Code, Cursor or any MCP client · no API key",
            font=geist(24, "Regular"),
            fill=MUTED,
        )

    draw.text((left, H - 64), "hamsanders.github.io/soundbox", font=geist(22, "Medium"), fill=MUTED)
    return im


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    cards = {
        "default.jpg": card(
            "studio.png",
            "Open source · MIT",
            "Konchi",
            "Sound effects, music and voices,\ngenerated on your own machine.",
        ),
        "mcp.jpg": card(
            None,
            "MCP server",
            "Konchi for agents",
            "Sound effects, music and speech,\ngenerated locally for your coding agent.",
            command="claude mcp add --transport http konchi http://127.0.0.1:17494/mcp",
        ),
    }
    for name, im in cards.items():
        path = OUT / name
        im.save(path, "JPEG", quality=85, optimize=True, progressive=True)
        print(f"{path.relative_to(ROOT)}: {path.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
