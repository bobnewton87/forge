// Cloud sign-in settings (CONTRACT §19, step-by-step in docs/accounts-setup.md).
// Leave supabaseUrl / supabaseAnonKey blank and Forge stays local-only: accounts still work on the device.
// The anon key is a public, browser-safe key; row-level security in supabase/schema.sql protects each user's rows.
export const config = {
  supabaseUrl: '',        // e.g. 'https://abcdefghijkl.supabase.co'
  supabaseAnonKey: '',    // Supabase → Project Settings → API keys → anon (public) key
  oauthProviders: [],     // e.g. ['apple', 'google'] once each is turned on in Supabase → Authentication → Providers
  redirectUrl: '',        // optional; defaults to the address the app is served from (must be in Supabase's Redirect URLs)
};
export default config;
