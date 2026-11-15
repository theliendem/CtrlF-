# Draws the extension icon at 16, 48 and 128 px.
# The F of Ctrl+F drawn as the panel's dig tree: a stem with branches growing right. The top branch and its
# node are highlighter yellow (the path to the find); the lower branch is a plain node still to read. Pen-ink tile.
# Shapes sit on a 16-unit grid so the 16 px toolbar icon stays crisp.
# Run: python3 scripts/make-icons.py  (needs Pillow). Output goes to public/icons/.
from pathlib import Path
from PIL import Image, ImageDraw

INK = (27, 36, 54, 255)         # --ink in the Notebook panel
LINE = (240, 243, 248, 255)     # near-white tree strokes
MARKER = (255, 207, 51, 255)    # the on-page highlighter (src/content)
S = 1024
U = S / 16  # one grid unit


def box(x0, y0, x1, y1):
    return (x0 * U, y0 * U, x1 * U - 1, y1 * U - 1)


def circle(cx, cy, r):
    return (cx * U - r * U, cy * U - r * U, cx * U + r * U, cy * U + r * U)


img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle(box(0, 0, 16, 16), radius=int(3.6 * U), fill=INK)

# Stem and the branch still to read, 2 units thick, in near-white.
d.rounded_rectangle(box(4, 3, 6, 13), radius=int(1 * U), fill=LINE)   # stem
d.rectangle(box(5, 8, 8, 10), fill=LINE)                              # middle branch
d.ellipse(circle(9.6, 9, 1.5), fill=LINE)                             # its node

# The found path: top branch and its node in highlighter yellow, like the trail to a hit in the panel.
d.rectangle(box(5, 3, 9, 5), fill=MARKER)
d.pieslice(circle(5, 4, 1), 90, 270, fill=MARKER)                     # round the top-left corner
d.ellipse(circle(11, 4, 2.1), fill=MARKER)

out = Path(__file__).resolve().parent.parent / 'public' / 'icons'
out.mkdir(parents=True, exist_ok=True)
for size in (16, 48, 128):
    img.resize((size, size), Image.LANCZOS).save(out / f'icon-{size}.png')
print('wrote', out)
