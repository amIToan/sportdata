# Athlete bulk deletion

CMS administrators and games administrators can select individual athletes, keep those selections across pages, select the current page, or select every result matching the current search and gender filter. Changing a filter clears the selection. The bulk confirmation shows the number and scope of profiles to delete.

`POST /athletes/bulk-delete/preview` accepts `{ filters }` and returns `{ total, selectionToken }`. A whole-list request to `POST /athletes/bulk-delete` uses `{ mode: 'ALL_MATCHING', filters, expectedCount, selectionToken }`. The token captures matching IDs and profile revisions, so a changed list returns `409` before deletion and requires selecting the list again. Individual selections use `{ mode: 'SELECTED', ids }` with up to 1,000 IDs; whole-list selections cover all pages.

The response reports every deleted or retained profile and its reason. Existing team membership and statistics references prevent deleting a profile. Successful deletion follows the same cascade rules as single-profile deletion: athlete identity, media and event registrations are removed; linked SportData accounts remain. Parent and media rows are locked before collecting private storage keys, and files are cleaned only after a successful database deletion.

Run `node --test apps/backend/scripts/athletes-bulk-delete.test.cjs` for request validation, list scope, stale snapshots, partial failure and file cleanup. `apps/backend/scripts/athletes-bulk-delete.integration.cjs --confirm-isolated-qa` exercises the actual API against an isolated QA database and local storage. Its fixtures are synthetic and cleaned up; it refuses to run without the explicit QA flag and a QA database name.
