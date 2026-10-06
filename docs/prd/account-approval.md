# PRD: Admin approval for new accounts

## Problem Statement
Anyone can create an account and immediately use the app — there is no gate between sign-up and full access to invoices, expenses and contracts. Worse, a user's role and tab permissions are stored where the user can edit them themselves, so any signed-in user can grant themselves admin.

## Solution
New accounts start **pending**. A pending user can sign in but only sees a "waiting for approval" page; every API call refuses them. Admins are emailed when someone signs up and see a Pending section on the Users page, where they approve (choosing the user's tabs in the same step) or reject (archive). Approved users get a "you're approved" email. Role and tab permissions move to server-only storage so they can no longer be self-assigned; the Users page keeps working the same way.

## User Stories
1. As an admin, I want new sign-ups to be blocked until I approve them, so that strangers can't see company data.
2. As an admin, I want an email when someone signs up, so that I don't have to keep checking the app.
3. As an admin, I want a Pending section with a count on the Users page, so that I can see who is waiting.
4. As an admin, I want to choose a new user's tabs when I approve them, so that nobody gets full access by default.
5. As an admin, I want to reject a sign-up by archiving it, so that a mis-click can be restored and the email can't simply sign up again.
6. As an admin, I want to keep choosing who is admin from the Users page, as today.
7. As an admin, I want users to be unable to make themselves admin or change their own tabs.
8. As a new user, I want a clear "waiting for approval" page after signing up, so that I know what's happening.
9. As a new user, I want an email when I'm approved, so that I know when I can sign in.
10. As an existing user, I want to keep my access unchanged when this launches.

## Implementation Decisions
- **Authorization storage:** `role`, `allowedTabs` and the new `approval` status live in Supabase `app_metadata` (writable only with the service role). `user_metadata` keeps only profile data (name). A one-time migration copies existing `role` / `allowedTabs` from `user_metadata` to `app_metadata`.
- **Approval status (fail closed):** a user is approved only if `app_metadata.approval === "approved"` (admins always are). A missing flag means pending, so new sign-ups need nothing special at creation and can't bypass it by calling Supabase Auth directly. A migration marks every existing account approved before the code deploys. (An earlier draft used a sign-up trigger to set `"pending"`; security review rejected it as fail-open — if the flag was ever lost, the user got in.)
- **Bootstrap admin:** the one-time "make me admin when none exists" endpoint also requires a server secret, since a migration mistake leaving no admin would otherwise let any sign-up take admin.
- **Enforcement:** the shared server auth check refuses pending users (403) for every guarded API route; the page middleware sends pending users to a dedicated pending page and keeps them there. Admins are never pending.
- **Approve:** admin-only endpoint sets `approval = "approved"` and the chosen `allowedTabs` together, then emails the user.
- **Reject:** reuses the existing archive (server-enforced ban), restorable from the archived list.
- **Admin notification:** the pending page asks the server to notify; the server claims pending users not yet notified (`app_metadata.signupNotifiedAt`), emails all admins, and releases the claim if the send fails. Uses the existing Resend setup. Links use `APP_URL` (falls back to the request origin).
- **Role management:** set-role, set-tabs, bootstrap-admin, archive and restore write `app_metadata` instead of `user_metadata`.

## Testing Decisions
- Test external behaviour of pure decision logic: "given these metadata, is the user approved / admin / allowed tabs" and "which users still need a sign-up email". Follow the existing `authGuard.test.ts` style (mocked Supabase client).
- Note: `authGuard.test.ts` currently has pre-existing failures; touching requireAuth means fixing those tests rather than adding to the red count.
- The DB trigger and middleware redirect are verified manually on a preview deploy (no DB/browser test harness in the repo).

## Out of Scope
- Bulk approve/reject from the new table checkboxes.
- Restricting sign-up by email domain.
- Locking the admin role to one account (admins keep choosing admins).
- Securing the other unguarded API routes (webhooks, cron, callbacks) — they use their own secrets. (`reminders/trigger` did its own login check and was moved onto the shared guard.)
- Server-side enforcement of `allowedTabs`: it only hides sidebar tabs today; API routes don't check it. Known gap, follow-up.
- Rate limiting `signup-notify`.
