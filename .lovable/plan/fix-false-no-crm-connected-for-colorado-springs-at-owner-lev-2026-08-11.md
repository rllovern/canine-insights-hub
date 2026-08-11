# Fix false "No CRM connected" for Colorado Springs at owner level

## What is actually happening

Colorado Springs **is** connected to GoHighLevel — the backend record says `is_connected = true`, `status = connected`, no failures. So the card is wrong, not the data.

The card's text comes from one small lookup: the app asks the backend "which properties have a GHL source?" and if that lookup returns **no rows for any reason**, the UI concludes "No CRM connected". Two things make that fragile:

1. The table holding data-source records is readable only by super admin / admin / owner roles. Anyone below that (location owner / viewer) sees zero rows and therefore always gets the false "No CRM connected" message, on every property.
2. If the request errors out (permission error, network blip, token refresh), the code swallows the error and returns an empty list — which renders exactly the same false message, even though the sales number and sparkline next to it still load.

Reproduced in the preview with a super-admin session: both super admin and previewed-owner render correctly. That confirms the message is driven by who is asking and whether the request succeeded, not by the property's real state. The exact failure mode for your signed-in owner account is not yet confirmed, so step 1 below verifies it before the fix ships.

## Plan

1. **Confirm the failing request.** Capture the actual response the owner-level session gets for the data-source lookup (permission error vs empty result). This decides whether the fix is only about access or also about error handling — both are covered below regardless.

2. **Make CRM status readable by anyone who can see the property.** Add a security-definer backend function that returns, for the requested properties, whether a GHL source is connected. It authorises on "can this user access this property" rather than "is this user staff". No credentials or config are exposed — only the property id and a connected flag. The client switches to this function.

3. **Stop treating failure as "not connected".** The lookup will distinguish three states: loading, error, answered. "No CRM connected" renders only when the backend answered and reported no connected source. While loading, the card shows its skeleton; on error, it shows the sales value with a small "connection status unavailable" note instead of a false claim.

4. **Verify.** Re-check Executive Overview and Sale Records for Colorado Springs across super admin, previewed owner, and location-owner surfaces, and confirm MoCo (genuinely no CRM) still correctly shows "No CRM connected".

## Technical notes

- Surfaces affected: `src/lib/crm-connection.ts` (hook), `src/pages/Command.tsx` (Verified Sale / revenue KPI cards), `src/pages/SaleRecords.tsx` (header + empty state).
- New RPC `public.crm_connection_status(_property_ids uuid[])` returning `(property_id uuid, connected boolean)`, `security definer`, filtered by `can_access_property(auth.uid(), property_id)`, `grant execute to authenticated`. `property_data_sources` RLS stays unchanged (raw rows remain staff-only).
- `useCrmConnection` gains `isError`; `noneConnected` becomes `answered && all.length > 0 && connected.length === 0`, and is false while loading or on error.