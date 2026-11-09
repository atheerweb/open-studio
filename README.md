# Open Studio

Open Studio is a local development workspace for editing Vue pages with Codex. Import a Vue/Vite frontend, browse its running preview, and ask Codex to change the page you are viewing. Inspect the source and diff beside the preview.

## Run locally

Requirements: Node.js 24+, npm, and the Codex CLI signed in with codex login. Start any backend service your Vue app normally uses before opening its preview.

~~~sh
npm ci
npm run build
npm start
~~~

Open <http://127.0.0.1:4320>. Use **Import Vue project** to select a trusted frontend folder with installed dependencies. Approve its npm dev command, then browse the preview. If the preview port is occupied, close the draft and choose another port on import.

In **Page agent**, approve sharing the selected Vue file and request with Codex, then describe the change. Open **Source** or **Diff** to review the draft. The agent edits one Vue file per request. Routes that cannot be matched automatically use the file selected in Explorer. Manual editing, undo, and restore are also available. Close the draft to stop its dev server and remove its private copy.

## How it works

- React and Vite build the interface. The Node server serves it on loopback.
- The frontend runs from a temporary draft copy on your computer. Use projects whose dev scripts you trust. The frontend can use its own backend, including an already running Laravel API.
- The Codex CLI runs a bounded, read-only task with the selected Vue source as input. Studio validates the exact replacement before saving it in the draft. The original working tree and Git index are outside the edit flow.
- Drafts are temporary. Applying a draft to the original project is outside this release. SSO providers that block embedding may need a separate browser tab.
- GitHub distributes the source. The working app needs the local Node server and Codex CLI.

Set OPEN_STUDIO_PORT to change the Studio port, or OPEN_STUDIO_CODEX_BIN to select a Codex executable. On Windows, the default executable is codex.exe.

~~~sh
npm test
~~~

Licensed under Apache-2.0.
