# Fix: tokenized report resets to "This month" while viewing

## Problem

While the user is on `/report/:token` (or `/admin/client-reports/:propertyId`), the page periodically re-renders and the date range selector snaps back to **This Month** (the default), losing any custom range the user picked. This makes longer review sessions impossible.

## Root cause

Two overlapping issues cause `DashboardProvider` to either re-mount or be perceived to reset:

1. **`PublicReport.tsx`** re-runs its property-loading `useEffect` whenever `setActiveProperty` changes identity. `PropertyProvider` does not memoize `setActiveProperty`, so every render of `PropertyProvider` creates a new function reference. Anything that re-renders `PropertyProvider` (Supabase auth token auto-refresh firing `onAuthStateChange`, `user` state churn, role loads, etc.) re-runs the effect → re-fetches the property → calls `setProperty(new object)` → flips the active property in `PropertyContext` → cascades another render.

2. **React Query** defaults to `refetchOnWindowFocus: true` and `refetchOnReconnect: true`. When the tab regains focus or network blips, queries refetch — visually appearing as a "refresh" even when state is preserved.

In combination, on the token-gated pages where the user expects a stable view, the toolbar visibly reverts and data re-flashes.

## Fix

### 1. Stabilize `PropertyContext` callbacks
File: `src/contexts/PropertyContext.tsx`
- Wrap `setActiveProperty` in `useCallback` so its identity is stable.
- (Already `useCallback` for `load`, keep as-is.)

### 2. Stop re-fetching the property on identity churn
File: `src/pages/PublicReport.tsx`
- Drop `setActiveProperty` from the `useEffect` dep array (or rely on the now-stable ref). Keep `[token]` only. The property only needs to load when the token changes.

### 3. Make the public/token report query stable across focus
File: `src/components/reports/TokenReport.tsx` (preferred — scope the change to the public/admin token view, don't touch the global QueryClient)
- Wrap the rendered subtree in a `<QueryClientProvider>` with a local client configured with `refetchOnWindowFocus: false`, `refetchOnReconnect: false`, and a generous `staleTime` (e.g. 5 min). This keeps the rest of the app's refetch behavior unchanged.

Alternative (simpler, broader): set those defaults on the shared `queryClient` in `src/App.tsx`. Open question below.

### 4. Defensive: ensure `DashboardProvider` never resets state from a prop change
File: `src/contexts/DashboardContext.tsx`
- Confirm the only place `setRangePresetState("mtd")` is called is the initial `useState`. No effect resets it. (Current code is fine — no change required, just verifying as part of the fix.)

## Files touched

- `src/contexts/PropertyContext.tsx` — memoize `setActiveProperty`
- `src/pages/PublicReport.tsx` — narrow effect deps to `[token]`
- `src/components/reports/TokenReport.tsx` — local `QueryClient` with focus/reconnect refetch disabled and a longer `staleTime`

## Open question

Do you want the "no auto-refresh while viewing" behavior to apply **only to the tokenized report pages** (recommended — keeps internal dashboards fresh), or **everywhere in the app**?
