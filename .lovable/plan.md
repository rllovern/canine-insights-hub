Do I know what the issue is? Yes.

The app is successfully reaching the `sync-ghl` edge function and the function is successfully reading the stored `GHL_PRIVATE_INTEGRATION_TOKEN`. The failure is coming back from Go High Level on this exact request:

```text
GET https://services.leadconnectorhq.com/contacts/?locationId=...
401: The token is not authorized for this scope.
```

That means the token exists, but Go High Level is refusing the Contacts endpoint for one of these reasons:

1. The Private Integration token does not include the Contacts read scope.
2. The token is agency/company-level but does not have access to the selected sub-account/location.
3. The location selected for the property does not belong to the same GHL account/token.
4. The token was regenerated in GHL but the saved backend secret is still the older token.

Files involved:

- `supabase/functions/sync-ghl/index.ts` — calls `/contacts/`, `/conversations/search`, `/conversations/{id}/messages`, and `/opportunities/search`.
- `supabase/functions/list-ghl-locations/index.ts` — lists available locations from the saved token.
- `src/components/data/GHLConnectionDialog.tsx` — lets you connect a property to a GHL location and trigger sync.

Plan to fix and make this clearer:

1. Improve GHL sync error handling
   - Detect GHL 401 scope errors separately from generic 500s.
   - Return a clearer message: token found, but missing scope or not authorized for this selected location.
   - Record the issue in integration health with the failed timestamp and GHL endpoint that failed.

2. Add a safe token diagnostic to the edge function logs
   - Log only token length, first 4 chars, and last 4 chars.
   - Never log the full token.
   - This helps confirm whether the backend is using the current token without exposing it.

3. Add a preflight health check for GHL
   - When syncing GHL, test the selected location against the Contacts endpoint first.
   - If unauthorized, fail fast with guidance instead of surfacing a generic edge function 500.

4. Confirm the location mapping is valid
   - Keep using the locations returned by `list-ghl-locations`, but surface a clearer warning if the selected property’s location is no longer accessible by the current token.

5. User-side requirement after code hardening
   - In GHL Private Integrations, the saved token must include at least:
     - Contacts read
     - Locations read
     - Conversations read
     - Conversation messages read
     - Opportunities read
   - If GHL regenerates the token after changing scopes, the backend secret must be updated with that regenerated token.

After implementation, the sync button will no longer show a vague `Edge function returned 500`; it will show the exact GHL authorization problem and the API Health page will retain the failure timestamp/details.

<presentation-actions>
  <presentation-open-history>View History</presentation-open-history>
</presentation-actions>

<presentation-actions>
<presentation-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</presentation-link>
</presentation-actions>