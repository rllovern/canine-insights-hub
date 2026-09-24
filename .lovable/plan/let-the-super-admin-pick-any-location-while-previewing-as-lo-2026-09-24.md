# Let the Super Admin pick any location while previewing as Location Owner

## What changes
When you (the real Super Admin, rl.lovern@gmail.com) switch the preview to **Location Owner**, the location box in the sidebar becomes a working picker listing every location. Whatever you pick is what the whole dashboard shows, exactly as that location's owner would see it. No more "Unknown property".

Real Location Owner accounts are unchanged: they still see only their one assigned location, with no picker.

## Why it says "Unknown property" today
- In Location Owner view the sidebar shows a fixed label, not a picker, so there's no way to choose.
- The page forces the scope to the first location in the list. When that runs before the list finishes loading, it saves an empty choice and the label reads "Unknown property".

## Technical details
- `ScopeSelector.tsx`: show the static label only when `isLocationOwner && !isPreviewing`. When previewing, show the normal picker but hide the "All locations" option (a location owner never has an all-locations view).
- `ScopeContext.tsx`: in the location-owner branch, when `isPreviewing`, keep the stored property if it exists in the list; otherwise pick the first one. Skip until the list has loaded and has entries, so an empty selection is never saved. Real location owners keep their forced single location.
- Gate uses the existing `isPreviewing` flag, which is true only for a real Super Admin — nobody else gets the picker.
- Verify in the preview: sign in, switch to Location Owner, pick two different locations, confirm the name and figures change and "Unknown property" never appears.
