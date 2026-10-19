# SnakeScale Notes: Attachment Providers Setup Guide

This guide is for Chris, the publisher of SnakeScale Notes. It covers the one time setup that makes attachment storage work in version 1.2.

## The short version

Attachments and images are not stored in GitHub. Each user stores them in their own Google Drive or pCloud account, in a folder named SnakeScale Notes Attachments. The note itself keeps only a small reference to each file.

Users sign in with OAuth. In the app they click a button labeled Sign in with Google or Sign in with pCloud, they approve access on that provider's own website, and they come back signed in. SnakeScale never sees their Google or pCloud password, and users never register anything.

Before those sign in buttons can work, the providers require the app itself to be registered. That registration is a ONE TIME publisher setup, done by Chris as the app owner. It produces two public client IDs, one from Google and one from pCloud. Registering both is free.

For this v1.2 test build, the two client IDs are pasted into the app under Attachments settings. Once Chris has created them and is happy with the test results, a later build should bake the public client IDs into the app itself. Client IDs are public identifiers, not secrets, so baking them in is safe. At that point normal users only ever click sign in: no fields, no developer accounts, no setup of their own.

End users will never need a Google Cloud project, a pCloud developer app, or any other developer account. That burden sits with the publisher, once, and that is the design on purpose.

## Part 1: Google Cloud OAuth client (one time, free)

1. Go to the Google Cloud Console at console.cloud.google.com and sign in with the Google account that will own the SnakeScale app.
2. Create a new project (or select one you already use for SnakeScale). Name it something clear like SnakeScale Notes.
3. In the left menu, open APIs and Services, then Library. Search for Google Drive API and click Enable.
4. Open APIs and Services, then OAuth consent screen.
   - Choose the External user type (this is what lets any Google user sign in, not just your own organization).
   - App name: SnakeScale Notes.
   - User support email: your email address.
   - Fill in the required contact fields and save.
5. On the consent screen's scopes step, add exactly one scope: https://www.googleapis.com/auth/drive.file
   - This scope limits SnakeScale to files it creates itself, plus files a user explicitly picks. The app cannot browse a user's whole Drive.
6. Open APIs and Services, then Credentials. Click Create Credentials, then OAuth client ID.
   - Application type: Web application.
   - Name: SnakeScale Notes Web.
   - Under Authorized JavaScript origins, add: https://clytherin-tech.github.io
   - Optional, only for testing the app from a local web server: also add http://localhost:8000
   - No redirect URI is needed for this sign in flow.
7. Click Create. Google shows a client ID that ends in apps.googleusercontent.com. Copy it.
8. Open SnakeScale Notes, unlock it, and open Attachments in the sidebar footer. Paste the client ID into the Google OAuth client ID field, then click Sign in with Google and approve access.

Publishing note: while the consent screen is in Testing mode, only Google accounts listed as test users can sign in. To let the public use it, publish the consent screen from the same OAuth consent screen page. Because drive.file is a non sensitive scope, publishing is usually straightforward, but Google may still show verification steps or ask for a privacy policy link before or after publishing. That is normal and only ever happens once, to the publisher.

## Part 2: pCloud app (one time, free)

1. Sign in to pCloud and open its developer or app registration console (from your pCloud account, look for the developer section where applications are registered).
2. Register a new application for SnakeScale Notes.
3. Set the redirect URI to exactly this address, with the trailing slash: https://clytherin-tech.github.io/snakescale/
   - The redirect URI must match character for character. When a user signs in, pCloud sends the browser back to this address with the access result.
4. Save the app. pCloud shows a client ID for it. Copy it.
5. Open SnakeScale Notes, unlock it, and open Attachments in the sidebar footer. Paste the client ID into the pCloud client ID field, then click Sign in with pCloud. You will be sent to pCloud to approve access, then returned to the app signed in.

Data location note: pCloud accounts live in either the United States or the European data region. The app does not make you choose. The sign in response tells the app the correct API hostname for the account (api.pcloud.com or eapi.pcloud.com), and the app stores and uses that hostname automatically.

## Testing checklist

Run through this once per provider, signed in to that provider in the app:

1. Connect the provider from Attachments settings and confirm the card shows Signed in with a green dot.
2. Open a note and attach one PNG image. Confirm it uploads, appears inline in the note, and the SnakeScale Notes Attachments folder now exists in the cloud account with the file inside.
3. Attach one PDF. Confirm it appears as a file card with its name and size.
4. Close the note, reopen it, and confirm the image loads again and the PDF card is still correct.
5. Download both files from inside the note and confirm they open and match the originals.
6. Remove the PDF from the note, confirm the prompt, and then check in the cloud account that the file is really gone.
7. Confirm the other provider is unaffected: sign in to it, attach a test file, and confirm the first provider's folder did not change.
8. Confirm search finds the note when you type part of an attachment file name.

## Honest limits of v1.2

- Google sign ins expire. The browser sign in flow Google offers apps like this one returns a short lived access token, about one hour, and no refresh token. When it expires, the app says so and the user clicks Sign in with Google again. Notes and attachments are not affected.
- pCloud browser downloads are untested until the first live account test. Uploads and API calls follow pCloud's published API, but the final step of a download fetches bytes from a pCloud file host, and whether that host allows browser downloads from another website (cross origin rules) can only be proven by Chris's live test in the checklist above. If it fails, the app shows a specific pCloud download message instead of a generic error, and that result decides the v1.3 fix.
- Attachments need the internet. Uploading, viewing an image for the first time, downloading, and removing all talk to the provider. Offline note reading and editing keep working exactly as before; attachment actions show a clear offline message instead of failing quietly.
- Files are capped at 100 MB each in v1.2. The user's original file is stored unchanged. The app does not convert, resize, or re-encode images.
- Apple is not included. iCloud Drive cannot be used directly by web apps, so Apple attachment storage is deferred to a possible future release.
