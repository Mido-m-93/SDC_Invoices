// Cookie (not localStorage) so the server can render the chosen language on the
// first paint of any full page load — avoids a Japanese flash before hydration.
// Kept out of index.tsx ("use client") so server components can import the value.
export const LANGUAGE_COOKIE = "app_lang";
