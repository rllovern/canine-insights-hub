## CR responses (pre-build checks)

**CR-1 (dark-mode tokens) — confirmed: must update both modes.**
Current `src/index.css` `.dark` block has `--sidebar-background: 222 55% 10%` (navy) and accent `222 45% 18%` — that's the old palette, not the true-dark target. Both `:root` and `.dark` sidebar token blocks will be repointed to the same values so the sidebar renders identically in either theme.

**CR-3 (GHL pipe) — indicator is telling the truth.**
`sync_runs` for `source='ghl'` shows the scheduled job has failed on every run for the last 72+ hours, every 6 hours, with `error_message: "Edge Function returned a non-2xx status code"`. `is_connected` is still true (token present) but the cron sync is broken. So:
- The Data Sources rail showing GHL = BLOCKED is correct.
- Lead Performance numbers you validated are reading data already in the DB; nothing new has landed for 3 days.
- This is a real outage in the `sync-ghl` edge function, separate from the styling task. **Recommend a follow-up turn to inspect edge-function logs and fix the 5xx.** Styling pass does not touch this.

**CR-4 (typeface) — confirmed Inter.**
`src/index.css` body rule: `font-family: "Inter", ui-sans-serif, system-ui, …`. The reference's letterforms match Inter (single-story `a`, rounded `g`, geometric digits). No family swap needed — the visible difference is weight, opacity, and row spacing, which this plan fixes.

## Build plan (unchanged from approval, with CR-1 + CR-2 folded in)

### Token changes — `src/index.css`

Repoint sidebar tokens in **both** `:root` and `.dark` to the same true-dark palette:

```
--sidebar-background: 220 14% 8%;
--sidebar-foreground: 0 0% 100%;
--sidebar-primary:    222 75% 60%;
--sidebar-primary-foreground: 0 0% 100%;
--sidebar-accent:     0 0% 100%;     /* used with opacity utilities */
--sidebar-accent-foreground: 0 0% 100%;
--sidebar-border:     220 10% 16%;
--sidebar-ring:       222 75% 60%;
```

### `src/components/layout/Sidebar.tsx`

- Brand block: revert to `<BrandMark variant="onDark" />`; remove blue "R" tile and "Acquisition Intelligence" subtitle row added last turn. Keep `border-b border-sidebar-border` divider.
- Rows: `py-2 px-3 gap-2.5 text-[14px] font-medium text-white/75`. Hover `bg-white/[0.04] text-white`. **Active = `bg-white/[0.07] text-white` only — no `font-semibold`, no left bar, no colored stripe** (CR-2).
- Icons: 16px, `text-white/55`; on hover/active `text-white`.
- Group labels: `text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45`, `px-3 pt-4 pb-1.5`.
- Jarvis row: identical row style to other items (no gold tint, no filled pill).
- Admin button: same row style; chevron `text-white/45`.
- Account card: `bg-white/[0.04] border border-white/10`, initials chip `bg-white/10 text-white`, email `text-white text-xs font-medium`, role `text-white/50 text-[10px] uppercase tracking-wider`, sign-out `text-white/55 hover:text-white hover:bg-white/[0.06]`.

### `src/components/layout/SourceHealthPanel.tsx`

- Section label uses the new group-label style.
- Row: keep dot, label `text-white/80 text-[13px]`, status text right-aligned `text-[10px] font-semibold uppercase tracking-[0.14em]` in `text-success` / `text-destructive` / `text-white/40`.
- No logic changes.

## Out of scope (unchanged)

- Logo image / `BrandMark` component internals.
- Nav hierarchy, labels, order, routes.
- Any non-sidebar surface.
- GHL sync outage — flagged for a separate turn.
- Data Sources data/RPC logic.

## Files touched

- `src/index.css` — `:root` and `.dark` sidebar token blocks.
- `src/components/layout/Sidebar.tsx`
- `src/components/layout/SourceHealthPanel.tsx`
