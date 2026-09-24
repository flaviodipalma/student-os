# Authentication setup

Student OS accounts use **Supabase Auth**. A student can log in with email and
password, **Google**, **Microsoft** or **Apple**. Every method signs in the same
kind of Student OS user: the Supabase user id is the Student OS user id, and all
courses, tasks, events, study sessions, preferences, notifications and LMS
connections belong to it.

**Login is not a calendar connection.** Signing in with Google or Microsoft asks
only for the student's identity (`openid email profile`). It never connects
Google Calendar or Outlook, and no calendar or mail scopes are requested. Calendar
and LMS connections are separate (Settings > Integrations, `src/server/integrations`).

```
Authentication (Supabase Auth)          Calendar integrations (src/server/integrations)
├── Email + password                    ├── Student OS
├── Google                              ├── Canvas
├── Microsoft                           ├── Blackboard
└── Apple                               ├── Google Calendar (future)
                                        └── Outlook Calendar (future)
```

## How it works

- `src/app/actions/auth.ts`: `continueWithProviderAction` starts the sign-in
  with `supabase.auth.signInWithOAuth` (PKCE; Supabase creates the state and
  code verifier and checks them). `linkLoginMethodAction` /
  `unlinkLoginMethodAction` add or remove a login method for the signed-in student.
- `src/app/auth/callback/route.ts`: exchanges the one-time code for a session,
  creates the Student OS profile on first sign-in (never overwrites one), and
  sends new students to onboarding. Errors become short codes
  (`/login?error=cancelled`) shown as plain messages.
- `src/lib/auth-providers.ts`: the three providers, their Supabase names and
  scopes, and the error messages.
- The provider's client ids and secrets live in the Supabase project only.
  Student OS stores no provider passwords or tokens; Supabase keeps each login
  method as an identity (provider + the provider's account id) in `auth.identities`.
- The log-in and sign-up pages show the providers the Supabase project has
  turned on (read from its public auth settings). In development all three show;
  one that isn't set up says so when clicked.

## Account linking

- **Automatic (Supabase's rule):** when someone signs in with a provider whose
  email is **verified** and matches an existing account's **verified** email,
  Supabase adds it to that account. It never links unverified emails, so an
  address alone can't take over an account.
- **Manual (Settings > Account > Login methods):** a signed-in student can add
  Google, Microsoft or Apple (`linkIdentity`) or remove one (never the last). A
  provider account already used by another Student OS account can't be added
  ("That account is already connected to a different Student OS account").
  Requires **Enable Manual Linking** in Supabase (below).
- Apple may hide the real email ("Hide My Email"): the account then has a
  `@privaterelay.appleid.com` address, which works but won't match the student's
  other email, so it won't link automatically. Students can add Apple from
  Settings > Account instead.

## Supabase settings (do these first)

In the Supabase dashboard for your project:

1. **Authentication > URL Configuration**
   - Site URL: `http://localhost:3000` (development) or your production address.
   - Redirect URLs, add both:
     - Development: `http://localhost:3000/auth/callback`
     - Production: `https://<your-domain>/auth/callback`
2. **Authentication > Sign In / Providers**: turn on **Allow manual linking**
   (for Settings > Account > Login methods).
3. Each provider below gives you a client id and secret to paste into its
   Supabase provider page. The provider's own redirect URI is **Supabase's**
   callback, shown on that page:
   `https://<project-ref>.supabase.co/auth/v1/callback`
   (the same for development and production; the app's own `/auth/callback`
   is the Supabase Redirect URL from step 1).

In production also set `SITE_URL` (see `.env.example`).

## Google

1. [Google Cloud Console](https://console.cloud.google.com/) > APIs & Services >
   **OAuth consent screen**: app name "Student OS", support email, scopes
   `openid`, `email`, `profile` only. While in "Testing", add the Google accounts
   allowed to sign in; publish it for everyone.
2. **Credentials > Create credentials > OAuth client ID**, type **Web application**.
   - Authorized JavaScript origins: `http://localhost:3000` and your production origin.
   - Authorized redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback`
3. Supabase > Sign In / Providers > **Google**: enable, paste the Client ID and
   Client Secret, save.

## Microsoft (Entra ID, personal + school/work accounts)

1. [Microsoft Entra admin center](https://entra.microsoft.com/) > Identity >
   Applications > **App registrations > New registration**.
   - Supported account types: **Accounts in any organizational directory and
     personal Microsoft accounts** (multi-tenant + personal).
   - Redirect URI: platform **Web**,
     `https://<project-ref>.supabase.co/auth/v1/callback`
2. **Certificates & secrets > New client secret**: copy the **Value** (not the
   Secret ID). It expires; note the date and renew it before then.
3. Optional: **Token configuration > Add optional claim** (ID token) `email`, so
   school accounts share their address.
4. Supabase > Sign In / Providers > **Azure**: enable, Client ID = Application
   (client) ID, Secret = the value from step 2, **Azure Tenant URL** empty (or
   `https://login.microsoftonline.com/common`) so any Microsoft account works.
   No Microsoft Graph or Outlook permissions are needed.

## Apple

Needs a paid Apple Developer account.

1. [Apple Developer](https://developer.apple.com/account/resources/) >
   Identifiers: an **App ID** with **Sign in with Apple** enabled.
2. Identifiers > **Services IDs**: create one (e.g. `com.yourname.studentos.web`;
   this is the **client id**), enable Sign in with Apple, Configure:
   - Primary App ID: the one from step 1.
   - Domains: `<project-ref>.supabase.co` (and your domain).
   - Return URLs: `https://<project-ref>.supabase.co/auth/v1/callback`
   (Apple doesn't accept `localhost`; development also uses the Supabase URL.)
3. Keys: create a key with **Sign in with Apple**, download the `.p8` file (once
   only), note the **Key ID** and your **Team ID**.
4. Supabase > Sign In / Providers > **Apple**: enable, Client IDs = the Services
   ID, Secret Key = a client secret generated from the `.p8`, Team ID, Key ID and
   Services ID (Supabase's Apple page links a generator). Apple client secrets
   expire after at most **6 months**: generate a new one before then.
5. Keep the `.p8` file out of the repository and out of `.env` files; it's only
   used to generate the secret.

Apple sends the student's name only on their **first** sign-in, and they may
hide their email. Student OS doesn't rely on either: onboarding asks for the name.

## Checking it

- Log in page: each enabled provider shows "Continue with …". Cancelling at the
  provider returns to the log-in page with "Sign-in was cancelled".
- A new student goes to onboarding; an existing one to the Dashboard.
- Settings > Account lists the login methods; adding one returns there with a
  confirmation.
