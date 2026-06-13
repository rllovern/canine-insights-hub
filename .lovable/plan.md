## Plan: prove the Jarvis auth chain end-to-end

1. **Frontend diagnostics before send**
   - In `JarvisChat`, add a development-only `[Jarvis Auth Debug]` log immediately before the AI SDK transport sends a request.
   - Log only sanitized session data: session presence, token prefix, expiry, seconds remaining, user id, and session error.
   - Update the Jarvis request headers to explicitly include:
     - `Authorization: Bearer <fresh access token>`
     - `apikey: <publishable anon key>`
     - `Content-Type: application/json`
   - Add a friendlier missing-session error: “Please sign in again.”

2. **Edge function diagnostics at request entry**
   - In `supabase/functions/jarvis/index.ts`, make `OPTIONS` return before auth validation with status `204` and full CORS headers.
   - Add temporary sanitized `[Jarvis Edge Auth Debug]` logging at the top of the handler:
     - whether Authorization exists
     - whether it starts with Bearer
     - token prefix only
     - whether apikey exists
   - Ensure every response, including auth failures, includes CORS headers.

3. **Replace auth validation with explicit anon-key + Bearer validation**
   - Replace the current `getClaims()` auth path with the requested `createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { Authorization: Bearer token })` + `auth.getUser()` path.
   - Log sanitized `[Jarvis Edge User Debug]` results:
     - `hasUser`
     - `userId`
     - `userErrorMessage`
   - Keep the service-role client only after user validation succeeds.

4. **Add isolated auth-only proof endpoint**
   - Add temporary `supabase/functions/jarvis-auth-debug/index.ts`.
   - It will not call Jarvis, tools, or the AI model.
   - It will read the Authorization header, validate the user with anon-key + Bearer token, and return:
     ```json
     {
       "hasAuthHeader": true,
       "hasUser": true,
       "userId": "...",
       "expiresInSeconds": 1234
     }
     ```
   - It will also use the same CORS headers and sanitized logging.

5. **Environment consistency proof**
   - Add sanitized edge logs that compare project host/ref shape only, not secret values:
     - backend `SUPABASE_URL` host
     - whether `SUPABASE_ANON_KEY` exists
     - whether `SUPABASE_SERVICE_ROLE_KEY` exists
   - Frontend already uses the project URL from Vite env; we’ll confirm the request URL matches the backend URL in the network request.

6. **Validation path before declaring fixed**
   - Use the browser/network/debug tools to prove:
     - frontend session exists before send
     - Jarvis request includes Authorization and apikey headers
     - edge function receives Authorization and apikey
     - edge function validates the user successfully
     - `jarvis-auth-debug` succeeds independently
     - normal Jarvis request proceeds past auth
   - Then test both preview and deployed app paths as far as the available tools allow.

## Current known signal

The latest captured request already shows an `Authorization` header, but it does **not** show an `apikey` header, and the captured JWT appears expired at request time. This plan will prove whether refresh, header forwarding, backend env, or validation is the actual break point instead of guessing.