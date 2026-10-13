# SportData account registration

All accounts use the same registration, login and `/account` page. Each account selects exactly one type: `ATHLETE`, `REFEREE`, `COACH`, `TEAM_LEADER`, `MEDICAL_STAFF`. CMS manages all accounts and their type at `/cms/accounts`. These types do not grant CMS permissions.

Migration `20261010100000_unified_sportdata_accounts` converts the old `FEDERATION` type to `TEAM_LEADER`, retaining organization, credentials, approval status and registration history. The former organization account URLs redirect to the common account/registration pages. Migration `20261010120000_single_sportdata_account_type` retains each account's existing primary `accountType` and reduces the compatibility array `accountTypes` to that single value. API validation and a database constraint enforce exactly one type, consistent with `accountType`. Event participation roles remain separate. A team leader associated with an organization still needs approval to submit official team registrations. Changes to that organization require approval again.

Personal account registration requires an identity type (`CCCD` or `PASSPORT`) and document number. CCCD accepts 12 digits; Passport accepts 5–20 letters or digits. Passport matching includes the country, following existing athlete identity rules.

Creating an account does not create an `Athlete`. Personal details and the encrypted document number are stored on `ParticipantAccount`. The profile API returns `hasAthleteProfile: false` and a compatibility projection of account details until an athlete is linked; that projection is never persisted as an athlete.

When the document matches exactly one existing athlete, registration links that athlete and uses its existing personal details. Name and date of birth must match before linking. A document already assigned to an account, an athlete already linked to another account, or multiple matching athletes returns a conflict. Existing linked athlete registrations appear in the account's ticket list.

When event registration creates an athlete for an account's document, it links the athlete if name and date of birth also match. Accounts can upload or replace their avatar and identity documents on `/account` regardless of their role or whether an athlete is linked.

`POST /participant-auth/me/media/:type`, `GET /participant-auth/me/media/:type` and the OCR confirmation endpoint use `ParticipantAccountMedia` when there is no linked athlete. Linked accounts continue to use `AthleteMedia`. Uploading files never creates an athlete. Account files remain private and can only be opened by the owner or authorized CMS reviewers. Images accept JPG, PNG and WebP; identity documents also accept PDF, up to 8 MB per file. Replacing a file resets its OCR/verification state, deletes the previous stored file after a successful database commit, and preserves it if saving fails. With `IDENTITY_OCR_ENABLED=false`, image and PDF identity documents are automatically verified.

Event participation files remain separate snapshots submitted through the event registration form. Account uploads do not silently replace those event files. OCR confirmation without `applyToProfile` only stores reviewed metadata; applying OCR cannot change an account's registered primary document number.

## CMS account directory and required event files

The `/cms/accounts` directory supports keyword search, account type, approval status, unit, activity and profile-completeness filters, sorting and server pagination. `GET /participant-auth/admin/accounts` returns `{ items, total, page, limit, summary }`; summary counts apply to the current filters. Deploy the updated backend and frontend together because the previous endpoint returned an array.

An event participant must have a stored avatar and either both CCCD sides or a passport matching the chosen identity type. An external photo link, an empty media row or a document-verification flag without a stored file does not satisfy this requirement. New registrations and confirmation paths enforce the requirement; existing incomplete account profiles remain visible with missing-file indicators.

CMS reviewers can inspect account photos and documents through authenticated media endpoints. For an account without a linked athlete, any direct account upload becomes the current profile source, including incomplete uploads. The directory otherwise uses a linked athlete or event-participation profile and keeps the document number with that source's files. It never fills missing documents by mixing event registrations. Account approval and document verification remain separate statuses.

CMS registration uploads files before eligibility checks and saves the files in the registration transaction. Failed or expired uploads cannot leave a confirmed registration without its files. Reusing an athlete can supplement a missing CCCD side or avatar, including when retrying a previously registered category.

## Deployment and verification

Apply all migrations, including `20261010090000_participant_account_identity` and `20261013110000_participant_account_media`, with `npm run prisma:deploy` before starting the updated backend. Use the existing valid `SETTINGS_ENCRYPTION_KEY` or `JWT_SECRET` for document encryption. Regenerate Prisma and deploy backend and frontend together.

Run `npm run prisma:generate`, `npm run build`, `npm run lint --workspace=@sportdata/frontend`, and `node tests/integration/participant-account-registration.cjs`. The regression script uses service/database doubles and does not modify a database.

Run `node tests/regression/participant-account-list.mjs` and `node tests/regression/registration-required-media.mjs` after the backend build for filtered account profiles and required registration media. `tests/integration/participant-account-list-live.cjs` verifies the account API against an isolated development backend/database, including PostgreSQL NULL behavior and protected image/PDF access; it creates and removes synthetic fixtures.

Run `node tests/regression/participant-account-media.cjs` and `node tests/regression/participant-account-media-system-settings.cjs` after the backend build for independent account uploads, replacement cleanup and OCR settings. `tests/integration/participant-account-media-live.cjs` exercises authenticated upload/read/replace and CMS previews against an isolated development backend/database.

Manual checks on a development database:

- Register with a new document: confirm the account opens and the CMS athlete count does not increase.
- For each account role without an athlete, upload and replace an avatar and CCCD/passport on `/account`; reload the page and verify the new files appear in the account and CMS. With OCR disabled, check both image and PDF documents show verified status.
- Register using an unlinked athlete's document and matching name/date of birth: confirm existing information and tickets appear, with no additional athlete.
- Try missing/invalid documents, a document already linked to an account, and mismatched personal details: confirm validation/conflict messages.
- Submit an event registration with the new account's document: confirm one athlete is created and linked to the account.
