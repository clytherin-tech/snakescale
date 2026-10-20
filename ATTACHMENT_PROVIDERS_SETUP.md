# SnakeScale Notes: Attachment Providers Setup Guide

This guide is for Chris, the publisher of SnakeScale Notes. It covers the one time setup that makes Google sign in, and with it attachment storage, work. Since v2.0, Google Drive is the only data store in SnakeScale: notes and attachments live in the same Google account, under one sign in.

## The short version

Notes live in a folder named SnakeScale Notes in each user's own Google Drive. Attachments and images live in the same account, in an attachments subfolder inside that same SnakeScale Notes folder. The note itself keeps only a small reference to each attachment file.

Users sign in with OAuth. In the app they click a button labeled Sign in with Google, they approve access on Google's own website, and they come back signed in. That one sign in covers notes and attachments alike. SnakeScale never sees their Google password, and users never register anything.

Before that sign in button can work, Google requires the app itself to be registered. That registration is a ONE TIME publisher setup, done by Chris as the app owner. It produces one public client ID from Google. Registering is free.

The client ID is baked into the app itself (since v1.4.2, in the PUBLISHER_GOOGLE_CLIENT_ID constant). Client IDs are public identifiers, not secrets, so baking one in is safe. Normal users only ever click sign in: no fields, no developer accounts, no setup of their own. The client ID field in the app's Attachments settings dialog is only an advanced override, kept for testing and for forks that registered their own Google OAuth client.

End users will never need a Google Cloud project or any other developer account. That burden sits with the publisher, once, and that is the design on purpose.

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
8. For the published SnakeScale app there is nothing to paste: the client ID from step 7 is the one baked into the app. Paste a client ID into the Google OAuth client ID field in Attachments settings only when testing a different client, or when running a fork with its own registration (a fork can also replace the PUBLISHER_GOOGLE_CLIENT_ID constant in the app file instead).

Publishing note: while the consent screen is in Testing mode, only Google accounts listed as test users can sign in. To let the public use it, publish the consent screen from the same OAuth consent screen page. Because drive.file is a non sensitive scope, publishing is usually straightforward, but Google may still show verification steps or ask for a privacy policy link before or after publishing. That is normal and only ever happens once, to the publisher.

## Testing checklist

Run through this once, signed in to Google in the app:

1. Sign in from the setup or gate screen and confirm the app loads your notes.
2. Open Attachments in the sidebar and confirm the Google card shows Signed in with a green dot.
3. Open a note and attach one PNG image. Confirm it uploads, appears inline in the note, and a SnakeScale Notes folder now exists in the Drive account with an attachments subfolder inside it holding the file.
4. Attach one PDF. Confirm it appears as a file card with its name and size.
5. Close the note, reopen it, and confirm the image loads again and the PDF card is still correct.
6. Download both files from inside the note and confirm they open and match the originals.
7. Remove the PDF from the note, wait out the undo window, and then check in the Drive account that the file is really gone.
8. Confirm search finds the note when you type part of an attachment file name.

## Honest limits

- Google sign ins expire. The browser sign in flow Google offers apps like this one returns a short lived access token, about one hour, and no refresh token. When it expires, the app says so and the user clicks Sign in with Google again. Notes and attachments are not affected.
- Attachments need the internet. Uploading, viewing an image for the first time, downloading, and removing all talk to Google Drive. Offline note reading and editing keep working exactly as before; attachment actions show a clear offline message instead of failing quietly.
- Files are capped at 100 MB each. The user's original file is stored unchanged. The app does not convert, resize, or re-encode images.
- Apple is not included. iCloud Drive cannot be used directly by web apps, so Apple attachment storage is deferred to a possible future release.
