// Run once: node scripts/get-ms-token.mjs
// This opens a browser login and gives you a refresh token for .env.local

import * as http from "http";
import * as https from "https";
import { URL, URLSearchParams } from "url";
import * as readline from "readline";

const TENANT_ID   = "44a34edd-0c60-4bd0-9c6a-0b14c8620f62";
const CLIENT_ID   = "cce2f0c3-c03a-4ee0-b687-3545bcc1f593";
const REDIRECT    = "http://localhost:9999/callback";
const SCOPE       = "https://graph.microsoft.com/Files.Read.All offline_access";

// Step 1: Print the auth URL for the user to open
const authUrl =
  `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize` +
  `?client_id=${CLIENT_ID}` +
  `&response_type=code` +
  `&redirect_uri=${encodeURIComponent(REDIRECT)}` +
  `&scope=${encodeURIComponent(SCOPE)}` +
  `&response_mode=query`;

console.log("\n========================================");
console.log("STEP 1: Open this URL in your browser:");
console.log("========================================");
console.log(authUrl);
console.log("\nWaiting for you to log in...\n");

// Step 2: Listen for the redirect
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:9999");
  const code = url.searchParams.get("code");

  if (!code) {
    res.end("No code received. Try again.");
    return;
  }

  res.end("<h2>Login successful! You can close this tab.</h2>");
  server.close();

  // Step 3: Exchange code for tokens
  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:    CLIENT_ID,
        grant_type:   "authorization_code",
        code,
        redirect_uri: REDIRECT,
        scope:        SCOPE,
      }),
    }
  );

  const tokens = await tokenRes.json();

  if (!tokens.refresh_token) {
    console.error("Failed to get tokens:", tokens);
    process.exit(1);
  }

  console.log("\n========================================");
  console.log("SUCCESS! Add this to your .env.local:");
  console.log("========================================");
  console.log(`AZURE_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log("\nDone!");
  process.exit(0);
});

server.listen(9999, () => {
  console.log("Listening on http://localhost:9999/callback ...");
});
