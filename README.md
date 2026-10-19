# SnakeScale Notes

![SnakeScale Notes logo](logo.png)

A free, open source, web based notes app inspired by the way Evernote works, with one big difference: your notes live in your own private GitHub repository, not on our servers. There are no SnakeScale servers. The app is a single HTML file that runs entirely in your browser.

Live app: https://clytherin-tech.github.io/snakescale/

## Why SnakeScale

- Free forever. The app is open source and your storage is your own GitHub account.
- Private by design. Notes are stored as plain Markdown files in a private repo that only you control.
- Works anywhere. Any modern browser on PC, tablet, or phone. No install required.
- Your data is yours. Export any time by downloading your data repo. It is just files.

## Features

- Notebooks, notes, and tags, with local full text search
- Rich text editor with headings, lists, and checklists
- Clickable, editable links in notes (v1.3.1, reworked in v1.3.2): Ctrl+click (Cmd+click on a Mac) opens a link in a new tab, and a plain click shows a small link popup where the address itself is clickable to open the link, and an Edit button lets you change that link's text or address in place. Only http, https, and mailto links can be opened or saved
- A full formatting toolbar (new in v1.3): an Insert menu (attachments, links, checklists, dividers, date and time), text styles (headings 1 to 3, quote, code block), font family and font size pickers, text and highlight color palettes with custom colors, strikethrough, text alignment, indent and outdent, and remove formatting. Fonts, sizes, and colors are saved as inline CSS styles in the note body, never as font tags, so formatted notes render the same on every device
- Attachments and inline images (new in v1.2): files are stored in your own Google Drive or pCloud account, in a folder named SnakeScale Notes Attachments, and your notes keep only a small reference to each file. You pick the provider in the app, sign in with OAuth (Sign in with Google or Sign in with pCloud), and attach by button, drag and drop, or pasting an image. Publisher setup for the sign in buttons is a one time job for the app owner: see [ATTACHMENT_PROVIDERS_SETUP.md](ATTACHMENT_PROVIDERS_SETUP.md). End users never register a developer app.
- Pinned notes, trash with restore, and delete forever
- Encrypted token vault: your GitHub token is stored in your browser encrypted with your password (PBKDF2 plus AES-GCM), never in plain text
- Offline reading and editing from the local cache, with queued changes synced when you reconnect
- Conflict safety: if a note changed somewhere else, saving creates a conflict copy instead of overwriting it
- Light and dark themes in the Deep Forest palette

## How to use it

1. Open the live app link above.
2. Create a GitHub personal access token (classic) with the repo scope checked, name it something like SnakeScale so you remember what it is for.
3. In the app setup screen, paste the token and choose an app password. The token is encrypted with that password and kept only in that browser.
4. Leave the data repo name as snakescale-notes-data, connect, and let the app create the private data repo for you.
5. Start writing. Repeat the quick setup in any other browser where you want your notes.

## How your data is stored

- One folder per notebook inside the notebooks folder of your data repo
- One Markdown file per note, with simple front matter and an HTML body
- A trash folder for deleted notes, and an index.json the app can rebuild from the folders at any time
- Attachments are different on purpose: the binary files live in your Google Drive or pCloud account, never in GitHub. The note file stores only a one line attachments list in its front matter (provider name and file ID) plus a placeholder in the body where the image or file card appears

## Privacy and security notes

- Note sync talks only to api.github.com from your browser. If you use attachments, the app also talks to the storage provider you signed in to (Google or pCloud), and Google's sign in script is loaded from Google only at the moment you click Sign in with Google. Provider tokens are stored in your browser encrypted with the same app password as your GitHub token, never in plain text.
- Anyone with your GitHub token has the access that token grants, so use a token you can revoke, and lock the app when you step away.
- SnakeScale Notes is not affiliated with Evernote Corporation.

## License

AGPL-3.0. See the LICENSE file. Anyone can use, study, and share this code, and anyone who hosts a modified version must share their changes under the same license.

## Current status

Version 1.3.2, build stamp 2026-10-19-SSN-V132. Built and tested first as a single file app, with a look and layout polish pass in v1.1, attachments with Google Drive and pCloud in v1.2, the formatting toolbar rebuild in v1.3, clickable note links in v1.3.1, and a clickable link address plus in place link editing in v1.3.2. Known limits: the formatting toolbar builds on the browser's built in editing commands, whose exact behavior varies a little between browsers; Google sign ins expire after about an hour and need a one click sign in again (the browser token flow gives no refresh token); the pCloud browser download path follows pCloud's published API but is untested against a live account until the publisher test in the setup guide is run; attachments need an internet connection, with a 100 MB per file cap; and there is still no service worker, so it is not installable as a full PWA. That is planned for a later release.
