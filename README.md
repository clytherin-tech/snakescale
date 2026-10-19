# SnakeScale Notes

![SnakeScale Notes logo](logo.png)

A free, open source, web based notes app inspired by the way Evernote works, with one big difference: your notes live in your own private GitHub repository, not on our servers. There are no SnakeScale servers. The app is a single HTML file that runs entirely in your browser.

Live app: https://clytherin-tech.github.io/snakescale/

## Why SnakeScale

- Free forever. The app is open source and your storage is your own GitHub account.
- Private by design. Notes are stored as plain Markdown files in a private repo that only you control.
- Works anywhere. Any modern browser on PC, tablet, or phone. No install required.
- Your data is yours. Export any time by downloading your data repo. It is just files.

## Features in v1.0

- Notebooks, notes, and tags, with local full text search
- Rich text editor with headings, lists, and checklists
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

## Privacy and security notes

- The app makes calls only to api.github.com from your browser.
- Anyone with your GitHub token has the access that token grants, so use a token you can revoke, and lock the app when you step away.
- SnakeScale Notes is not affiliated with Evernote Corporation.

## License

AGPL-3.0. See the LICENSE file. Anyone can use, study, and share this code, and anyone who hosts a modified version must share their changes under the same license.

## Current status

Version 1.0, build stamp 2026-10-18-SSN-V10. Built and tested first as a single file app. Known v1.0 gap: no service worker yet, so it is not installable as a full PWA. That is planned for v1.1.
