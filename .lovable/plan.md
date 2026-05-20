# Use property logo in report header

## Problem
`src/components/layout/PublicShell.tsx` hardcodes the Ridgeside Ashtabula logo for every client report (both authenticated `/dashboard` view and the public tokenized URL). Logos uploaded via the admin Edit Property dialog are saved to `properties.logo_url` but never displayed.

## Change
In `PublicShell.tsx`, render `property.logo_url` when present; fall back to the bundled Ridgeside logo when the property has no custom logo set.

```tsx
<img
  src={property.logo_url || ridgesideLogo}
  alt={property.name}
  className="h-12 w-auto max-w-full object-contain sm:h-14"
/>
```

No other files change. The admin report view (`/admin/client-reports`) already wraps the same `PublicShell`, so it inherits the fix automatically. No backend, routing, or layout changes.
