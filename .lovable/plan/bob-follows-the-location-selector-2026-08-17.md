# Bob follows the location selector

Bob currently only works when a single property is selected, and he takes that property from either the URL or the dashboard. When the selector is set to "All locations" he has nothing to look at, and nothing stops a chat from being steered to another location.

## What changes

1. **The location selector is Bob's only source of truth.**
   Bob reads the scope from the same selector the rest of the app uses. Change the location in the sidebar and Bob's next answer is about that location. No separate picker inside the chat.

2. **"All locations" works.**
   When the selector is on all locations, Bob answers across the whole portfolio: he can list the locations he can see, pull numbers for each, and roll them up or compare them. He names locations explicitly so it is clear what he is summarising.

3. **A single location means only that location.**
   When one location is selected, every lookup is pinned to it. Bob will not pull or discuss another location's numbers, even if asked by name — he says which location he is currently looking at and that the selector needs to change.

4. **Location owners are hard-locked.**
   A location owner can only ever be answered about their own location. This is enforced on the server, not just in the prompt: the request's scope is intersected with the locations the signed-in user actually has access to, and anything outside it is rejected before any data is read.

## Technical detail

- `src/components/bob/BobChat.tsx`
  - Drop the `?propertyId=` URL override and the in-chat property `Select`; source scope from `useScope()` (`mode`, `propertyId`, `propertyIds`, `label`).
  - Send `scope: { mode, propertyId, propertyIds, label }` in the request body alongside the existing date range; keep `propertyId` for backwards compatibility with saved sessions.
  - Replace the "Pick a location" empty state with the normal greeting (agency mode is now valid); keep the "no properties" state.
  - Show the active scope label in the chat header so the user sees what Bob is bound to.
  - `AskBobButton` keeps deep-linking prompts but stops passing `propertyId`.

- `supabase/functions/jarvis/index.ts`
  - Resolve an **allowed set** server-side: query the properties the JWT user can access (`user_can_access_property` / role check). Intersect the client-sent scope with it. If the client sends a property the user cannot access → 403 as today; if agency mode → allowed set is the user's full accessible list.
  - Put `allowedPropertyIds` and `scopeMode` on `Ctx`. In `resolveProperty`, reject any `property_id` argument outside `allowedPropertyIds` (returns a tool error the model reports as "that location isn't in view"), and in single-location mode ignore/reject anything other than the pinned id.
  - Add a `list_locations` tool returning id + name for the allowed set, so Bob can fan out in agency mode.
  - Allow the existing per-property tools to be called once per location in agency mode (they already take `property_id`); when scope is a single property, `property_id` defaults to it as today.
  - Replace the `missing_property_id` error path with guidance to call `list_locations` first.
  - Update `ACTIVE CONTEXT` header and system prompt: state the current scope (single location name vs. all locations), the rule that Bob never discusses out-of-scope locations, and that in agency mode he should compare/roll up by name.
  - Persist `ai_agent_sessions.property_id` as before for single scope, `null` for agency.

- No schema changes; enforcement rides on existing access functions.
