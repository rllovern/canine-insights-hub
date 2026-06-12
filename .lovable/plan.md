## Drag-to-reorder sidebar nav

Make every nav link in the sidebar draggable so each user can arrange them in any order. Order persists per user in the database and follows them across devices. Analytics and Admin items can be mixed into one combined list.

### Behavior
- Click-and-hold on any nav item → drag to a new slot → release to drop.
- A subtle drop indicator (1px line in `--sidebar-primary`) shows where the item will land.
- The active route highlight, icons, and labels stay the same — only position changes.
- Sign-out, brand mark, and user card are not draggable.
- Section headers ("Analytics" / "Admin") are removed since items can now mix freely; only internal users still see Admin-only items, but they appear inline in the user's chosen order.

### Persistence
- New table `user_nav_preferences`: one row per user holding their ordered list of nav keys.
- On first load, if no preference exists, use the current default order.
- Reorder writes the new order back immediately (optimistic UI; revert + toast on failure).
- Nav items the user doesn't have access to (e.g. Admin items for viewers) are filtered out at render time, but their position is preserved in storage in case the role changes later.

### Technical details

Schema (one migration):
```sql
CREATE TABLE public.user_nav_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  order_keys text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_nav_preferences TO authenticated;
GRANT ALL ON public.user_nav_preferences TO service_role;
ALTER TABLE public.user_nav_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own row select" ON public.user_nav_preferences FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own row write"  ON public.user_nav_preferences FOR ALL    TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER user_nav_prefs_updated BEFORE UPDATE ON public.user_nav_preferences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

Frontend (`src/components/layout/Sidebar.tsx`):
- Define a single `NAV_ITEMS` array with `{ key, to, label, icon, requiresInternal }`.
- Keys: `dashboard`, `calls`, `reports`, `budget`, `clients`, `client-reports`, `users`, `settings`.
- Load `user_nav_preferences.order_keys` for `auth.uid()` on mount; merge with defaults (any new keys not in saved order go to the end).
- Filter out items the user can't see based on `effectiveRole`.
- Use native HTML5 drag-and-drop (`draggable`, `onDragStart/Over/End/Drop`) — no new dependency. Add `cursor-grab` / `active:cursor-grabbing`, and a thin top/bottom indicator on hover during drag.
- On drop: compute new full key order (including hidden-but-stored keys), `upsert` into `user_nav_preferences`, then update local state.

Out of scope:
- A reset-to-default button (can add later if asked).
- Touch reorder on mobile (mobile uses a separate menu; we'll keep its order linked to the same preference but without drag for now).
