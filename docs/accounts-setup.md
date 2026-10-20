# Turning on cloud sign-in (Supabase)

Forge works fully without this: accounts and test accounts live on the phone. These steps add sign-in so an
account is backed up and syncs between devices. Plan on about 20 minutes for email sign-in. Apple and Google sign-in
are optional extras for later.

What you need: a free Supabase account, this repo, and (for Sign in with Apple only) an Apple Developer account.

## 1. Create the Supabase project (free)

1. Go to <https://supabase.com>, sign up, and click **New project**.
2. Name it `forge`. Pick a region near you (for example *East US (Ohio)*).
3. Set a database password and save it in your password manager. Forge never needs it, but you will if you ever
   connect to the database directly.
4. Wait a minute or two while the project is created.

Free-plan note: Supabase pauses a free project after about a week with no activity. Your data is kept. Open the
dashboard and click **Restore** to wake it. While it's paused Forge keeps working on the phone and the Accounts
section shows a sync error.

## 2. Create the table and functions

1. In the project, open **SQL Editor** and click **New query**.
2. Paste the whole of [`supabase/schema.sql`](../supabase/schema.sql) and click **Run**. It should say "Success.
   No rows returned". Running it again is safe.
3. Check it: **Table Editor** should list `forge_state`, marked as RLS enabled.

This creates:
- `forge_state`: one row per synced item (your profile, body log, measurements, each workout…).
- Row-level security, so each signed-in person can only read and change their own rows.
- `forge_push`: saves a batch of changes, keeping a row only if it's newer than the one stored.
- `delete_my_account`: lets someone delete their own account from inside the app (Apple requires this).

## 3. Put the project's URL and public key in the app

1. Open **Project Settings → API Keys** (on older dashboards, **Project Settings → API**).
2. Copy the **Project URL** (looks like `https://abcdefghijkl.supabase.co`). It's also shown on the project home page.
3. Copy the **publishable** key (`sb_publishable_…`). If you only see legacy keys, copy the **anon public** key.
   **Never** use the `secret` or `service_role` key. Those skip all security and must never go in the app.
4. Edit `js/config.js`:

   ```js
   export const config = {
     supabaseUrl: 'https://abcdefghijkl.supabase.co',
     supabaseAnonKey: 'sb_publishable_xxxxxxxx',
     oauthProviders: [],
     redirectUrl: '',
   };
   ```

   The public key is meant to be visible in a web app. Row-level security is what protects the data.

## 4. Turn on email sign-in

1. **Authentication → Sign In / Providers → Email**: make sure it's enabled (it is by default).
2. **Confirm email**: on means a new account must click a link in an email before it can sign in. Forge handles both
   ways. Turning it off while you test is easier. Turn it back on before launch.
3. **Authentication → URL Configuration**:
   - **Site URL**: `https://bobnewton87.github.io/forge/`
   - **Redirect URLs**: add `https://bobnewton87.github.io/forge/` and, for testing on your computer,
     `http://localhost:8642/`.
4. Emails (confirmations, password resets): the built-in sender only delivers to your own Supabase team's
   addresses and is heavily rate-limited. That's fine while you test. Before other people sign up, set up custom
   SMTP under **Authentication → Emails → SMTP Settings** (Resend, Postmark and Amazon SES all have free or cheap
   tiers).

## 5. Deploy and try it

1. Commit `js/config.js` and push. GitHub Pages redeploys in a minute or so.
2. On the phone: **More → Settings → Accounts → Sign in or create account**. Enter an email and password and tap
   **Create account**.
   - The first account gets this phone's data uploaded. Your local data is not changed.
   - The Accounts section then shows "Signed in as …" and "Last synced …".
3. Signing in on a second device (or the same phone after **Add account → Sign in to an existing cloud account**)
   downloads the data.
4. If a device already has its own data, Forge asks what to do: **Merge both** (recommended), **Upload this
   device's data to the account**, or **Replace this device's data with the account's**. Replace keeps a safety copy
   on the device, which you can restore from that account's screen.
5. You can check rows in **Table Editor → forge_state**.

Test accounts never sync, so screenshots of test people never reach the cloud.

## 6. Sign in with Apple (later, needs an Apple Developer account)

App Store rule 4.8: if the app offers Google sign-in, it must also offer Sign in with Apple. Email-only is fine
without it.

1. At <https://developer.apple.com/account> → **Certificates, IDs & Profiles**:
   1. **Identifiers → App IDs**: create (or open) the app's App ID and tick **Sign in with Apple**.
   2. **Identifiers → Services IDs**: create one (for example `com.bobnewton.forge.web`), tick **Sign in with Apple**
      → **Configure**: primary App ID = the one above; **Domains**: `abcdefghijkl.supabase.co`;
      **Return URLs**: `https://abcdefghijkl.supabase.co/auth/v1/callback`.
   3. **Keys**: create a key with **Sign in with Apple** enabled and download the `.p8` file (you can download it
      only once). Note the **Key ID** and your **Team ID** (top right of the page).
2. In Supabase → **Authentication → Sign In / Providers → Apple**: enable it, set **Client IDs** to the Services ID
   (add the app's bundle ID too once there is a native app), and paste a **Secret Key** generated from the `.p8`, Key
   ID, Team ID and Services ID (the Supabase Apple guide links a generator). Apple makes this secret expire after at
   most 6 months, so put a calendar reminder to make a new one.
3. In `js/config.js`: `oauthProviders: ['apple']`. A **Continue with Apple** button appears on the sign-in sheet.

## 7. Google sign-in (later)

1. At <https://console.cloud.google.com>: create a project, then **APIs & Services → OAuth consent screen**
   (External; app name Forge; your support email). Add `supabase.co` under authorized domains.
2. **Credentials → Create credentials → OAuth client ID → Web application**:
   - Authorized JavaScript origins: `https://bobnewton87.github.io`
   - Authorized redirect URIs: `https://abcdefghijkl.supabase.co/auth/v1/callback`
3. Copy the Client ID and Client secret into Supabase → **Authentication → Sign In / Providers → Google** and enable it.
4. In `js/config.js`: `oauthProviders: ['apple', 'google']`.

## Deleting accounts (App Store 5.1.1(v))

Settings → Accounts → tap the signed-in account → **Delete cloud account** → type DELETE. This calls
`delete_my_account`, which removes the person's login and every synced row. Forge then asks whether to also remove the
data from the phone or keep it as a local account. "Delete from this device" on any account only removes the local copy.

## When the app is wrapped for the App Store

Email and password sign-in work unchanged inside a native wrapper (for example Capacitor). OAuth redirects back to a
web page don't, so the wrapper will need a deep link (custom URL scheme or universal link) added to Supabase's Redirect
URLs and set as `redirectUrl` in `js/config.js`. Native Sign in with Apple is the better experience there.

## Troubleshooting

| Message | Fix |
|---|---|
| "Cloud sign-in isn't set up yet" | `js/config.js` is blank, or the new version hasn't deployed yet. |
| "Invalid API key" | Wrong key in `js/config.js`. Use the publishable / anon key from step 3. |
| "Not found on the server. Was supabase/schema.sql run?" | Run step 2. |
| "Email not confirmed" | Click the link in the confirmation email, or turn off **Confirm email** while testing. |
| Apple/Google says the redirect URL doesn't match | The callback must be exactly `https://<project>.supabase.co/auth/v1/callback`, and the app's address must be in **Redirect URLs** (step 4). |
| "Signed out. Sign in again to sync." | The login expired or was revoked. Data on the phone is kept; sign in again and it resumes. |
