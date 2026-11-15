# Draws the extension icon (green tile, white magnifier with a "+" inside) at 16, 48 and 128 px.
# Run: python3 scripts/make-icons.py  (needs Pillow). Output goes to public/icons/.
from pathlib import Path
from PIL import Image, ImageDraw

GREEN = (30, 158, 74, 255)  # --green in the side panel
WHITE = (255, 255, 255, 255)
S = 1024  # draw large, then downscale for smooth edges

img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.22), fill=GREEN)

# Lens
cx, cy, r, ring = int(S * 0.43), int(S * 0.43), int(S * 0.24), int(S * 0.085)
d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=WHITE, width=ring)
# Handle
d.line((cx + r * 0.68, cy + r * 0.68, S * 0.80, S * 0.80), fill=WHITE, width=int(S * 0.11))
d.ellipse((S * 0.80 - S * 0.055, S * 0.80 - S * 0.055, S * 0.80 + S * 0.055, S * 0.80 + S * 0.055), fill=WHITE)
# Plus inside the lens
arm, bar = int(r * 0.48), int(S * 0.055)
d.rectangle((cx - arm, cy - bar // 2, cx + arm, cy + bar // 2), fill=WHITE)
d.rectangle((cx - bar // 2, cy - arm, cx + bar // 2, cy + arm), fill=WHITE)

out = Path(__file__).resolve().parent.parent / 'public' / 'icons'
out.mkdir(parents=True, exist_ok=True)
for size in (16, 48, 128):
    img.resize((size, size), Image.LANCZOS).save(out / f'icon-{size}.png')
print('wrote', out)
