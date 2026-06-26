Plan:
1. Move the sticky behavior from the sidebar element itself to the shell layout so the left rail is pinned to the viewport while the right content scrolls.
2. Update `AppShell` to use a fixed-height viewport layout with the main content as the scroll container.
3. Adjust `Sidebar` so it remains full-height and internally scrollable only if its own contents exceed the viewport, keeping the Data Sources panel/user block visible.
4. Verify on `/command` by scrolling down and confirming the sidebar does not leave the viewport.