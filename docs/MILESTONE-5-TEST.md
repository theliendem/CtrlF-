# Graph polish: Chrome check

Reload **Ctrl+F++** at `chrome://extensions`, refresh the MATH345 tab, and open the panel with **Cmd+Shift+F**. Search an Exact phrase from Modules that appears in a nested page or PDF.

1. New nodes slide out from their parent. The tree re-flows smoothly with no jumps as nodes appear and disappear.
2. Reading nodes are yellow, pulse gently, and send out a ripple. Their incoming edge is tinted yellow.
3. A hit turns bright green with a short ripple and a label. Every ancestor of a hit turns faint green, including gray ones, and the edges along that path turn green.
4. Ruled-out nodes go gray, then shrink and fade out over about a second while the tree closes the gap.
5. The camera follows the yellow nodes. Once the tree is too big to fit legibly, it zooms out no further than about 60% while digging, then fits the whole tree when the dig ends.
6. Scroll to zoom around the cursor and drag to pan. Following pauses for 5 seconds after you stop. Double-click empty space to resume it at once. A drag never opens a result, and clicking a green node still opens it.
7. Labels: leaf hits are labelled to the right. Hits with visible children are labelled above the dot.

Report anything that snaps, jitters, or overlaps badly, with a screenshot.
