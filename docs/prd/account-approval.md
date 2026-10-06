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
- **Approval status:** `app_metadata.approval` is `"pending"` for new accounts, absent or `"approved"` otherwise. Absent = approved, so existing accounts are grandfathered without a backfill.
- **Pending at creation:** a `before insert` trigger on `auth.users` sets `approval = "pending"` (same pattern as the former signup-domain trigger), so it can't be bypassed by calling Supabase Auth directly.
- **Enforcement:** the shared server auth check refuses pending users (403) for every guarded API route; the page middleware sends pending users to a dedicated pending page and keeps them there. Admins are never pending.
- **Approve:** admin-only endpoint sets `approval = "approved"` and the chosen `allowedTabs` together, then emails the user.
- **Reject:** reuses the existing archive (server-enforced ban), restorable from the archived list.
- **Admin notification:** after sign-up, the app asks the server to notify; the server emails all admins about pending users not yet notified and records `app_metadata.signupNotifiedAt` so each sign-up is emailed once. Uses the existing Resend setup.
- **Role management:** set-role, set-tabs, bootstrap-admin, archive and restore write `app_metadata` instead of `user_metadata`.

## Testing Decisions
- Test external behaviour of pure decision logic: "given these metadata, is the user approved / admin / allowed tabs" and "which users still need a sign-up email". Follow the existing `authGuard.test.ts` style (mocked Supabase client).
- Note: `authGuard.test.ts` currently has pre-existing failures; touching requireAuth means fixing those tests rather than adding to the red count.
- The DB trigger and middleware redirect are verified manually on a preview deploy (no DB/browser test harness in the repo).

## Out of Scope
- Bulk approve/reject from the new table checkboxes.
- Restricting sign-up by email domain.
- Locking the admin role to one account (admins keep choosing admins).
- Securing the 11 unguarded API routes (webhooks, cron, callbacks) — they use their own secrets and are unaffected.
