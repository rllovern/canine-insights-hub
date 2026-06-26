## Change
In `src/pages/Command.tsx`, hide the Business/Ads toggle when the viewer is not the owner (i.e. Bob's view or any non-owner viewer). Force `mode = "business"` for those users so only blended data renders.

## Implementation
- Compute `ownerView = isOwner && !impersonateBob` (already exists).
- Only render the toggle `<div>` when `ownerView` is true.
- Derive `mode` as `ownerView ? (searchParams.get("mode") === "ads" ? "ads" : "business") : "business"`.
- Skip `setMode` wiring for non-owners (no URL param writes).
- All KPI labels/sources already branch on `isAds`; with `isAds=false` for viewers, they show blended copy ("Ad Spend", "Records", "Qualified Calls", "Verified Sale") — no other changes needed.

## Out of scope
Owner view behavior, sidebar, Performance Report block.
