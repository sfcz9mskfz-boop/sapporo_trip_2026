

Update: v48 fixes incomplete Google Maps shared-list imports.
- The observed 10-place result matches parseforge actor's free-run cap.
- Default actor order now tries full-list pay-per-result actors before parseforge:
  1. maximedupre/google-maps-shared-list-scraper
  2. automation-lab/google-maps-shared-list-scraper
  3. getascraper/google-maps-list-scraper
  4. parseforge/google-maps-shared-list-scraper
- APIFY_ACTOR_ID can override the actor used.
- Better list-name extraction from sourceListNames/sourceListTitles and list metadata.
- After redeploy, refresh old imported lists or delete/re-import them.


Update: v49 fixes silent fallback:
- If APIFY_ACTOR_ID is set, the backend uses ONLY that actor.
- It no longer falls back to parseforge, which can return only 10 places in free test mode.
- The app displays actorUsed in each saved-list row so you can verify which actor actually ran.
- Recommended env vars:
  APIFY_TOKEN=<your Apify token>
  APIFY_ACTOR_ID=maximedupre/google-maps-shared-list-scraper


Update: v50 removes visible import error states:
- Backend returns HTTP 200 with ok:false instead of surfacing 4xx/5xx import setup failures.
- Frontend saves the shared-list link quietly when import cannot complete.
- UI shows calm "설정 확인 필요 / setup check needed" instead of "error" or "failed".
- Existing saved lists can be retried using the per-list Refresh button.


Update: v51 prevents actual runtime import errors:
- Uses background Apify runs instead of long synchronous run-sync calls.
- /api/import-google-list starts the actor quickly and the frontend polls for results.
- The backend always returns HTTP 200 with safe JSON, even if setup is incomplete.
- Frontend fetch/polling is fully caught and saves the list link instead of throwing.
- This avoids Vercel/browser errors caused by long-running scraper requests.


Update: v52 fixes the most likely cause of deployed import not starting:
- Apify REST API paths expect an Actor ID or tilde-separated username~actor-name.
- Vercel env value can remain APIFY_ACTOR_ID=maximedupre/google-maps-shared-list-scraper.
- The backend now converts it to maximedupre~google-maps-shared-list-scraper only for the API path.
- Refresh now polls a saved runId before starting another run.


Update: v53 removes the helper/explanatory text directly below the Google saved-list section title.


Update: v54 restores reliable import behavior:
- Saves the list row immediately when Import is tapped.
- Uses Apify run-sync-get-dataset-items for direct results.
- Tries APIFY_ACTOR_ID / maximedupre first for full-list import.
- Falls back to parseforge if the preferred actor returns no places, restoring the earlier 10-place behavior instead of showing zero.
- Keeps the helper text below the section title removed.


Update: v57 switches Google saved-list import to the self-hosted Cloudflare Worker / ParseForge scraper:
- Default endpoint is now https://gmap-scraper.sfcz9mskfz.workers.dev/api/import-google-list
- The iPhone app no longer requires pasting the endpoint in the gear settings.
- APIFY_TOKEN / APIFY_ACTOR_ID is no longer needed for the app import path.
- If import is slow on the free Cloudflare Worker / ParseForge plan, open /health once to wake the backend, then try again.
