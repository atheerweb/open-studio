# Open Studio

Open Studio is a local development workspace for editing Vue projects with Codex. Open a local folder or Git repository, edit the original files, and use Source Control to review, commit, and push changes.

## Run locally

Requirements: Node.js 24+, npm, Git for Source Control, and the Codex CLI signed in with `codex login`. Start any backend service your Vue app normally uses before opening its preview.

~~~sh
npm ci
npm run build
npm start
~~~

Open <http://localhost:4320> and select **Open Folder**. The folder chooser opens on the desktop running Open Studio and requires Zenity on Linux. For a trusted Vue/Vite project with installed dependencies, select **Start preview** to run its npm dev command in the original folder.

Use **Select element** in the preview toolbar, then click an element. Studio uses Vue's development metadata to find the owning component when available. Use Explorer to select a Vue file manually. In **Page agent**, approve sharing project context and messages with Codex. The agent can prepare changes across several files. For shared-component edits, Studio lists the routes it can trace and waits for approval. Source saves and applied Codex edits update the original files directly.

Open **Source Control** or **Diff** to see staged, unstaged, and untracked files across the repository. Select a file to review its diff. Use **+** to stage or **−** to unstage, enter a message, and choose **Commit** or **Commit & Push**. Use **Push** to send existing commits. Studio uses your Git credentials and the current branch's upstream. For a branch without an upstream, Studio uses `origin` or the sole configured remote and sets the upstream on success.

## Signal design system

Open Studio uses warm graphite surfaces with lime for the current file, focused controls, and primary actions. Git additions use fern, deletions use rose, and warnings use amber. File status letters, line markers, and focus outlines make those states readable without relying on color alone.

`src/theme.css` is the source of truth. Palette values feed semantic roles such as `--ground`, `--accent`, and `--success`. The editor and file selectors use component tokens that inherit those roles. Use the shared UI and code fonts, spacing, and radii for new controls. Keep the browser chrome color in `index.html` aligned with the shell token.

## How it works

For React development with Fast Refresh, run `npm run dev` and open
<http://localhost:4321>. The Codex and workspace API runs on the same
address, so there is no second server to start.

- React and Vite build the interface. The Node server serves it on loopback.
- The frontend runs from the open folder. Use projects whose dev scripts you trust. The frontend can use its own backend, including an already running Laravel API.
- The Codex CLI resumes a session in the open folder using read-only tools. Studio validates its proposed text edits before applying them. Route impact is inferred from statically recognized router definitions and Vue imports.
- Studio stores chat state under `~/.open-studio/drafts` by default. Use `OPEN_STUDIO_DRAFTS_DIR` to choose another location. SSO providers that block embedding may need a separate browser tab.
- GitHub distributes the source. The working app needs the local Node server and Codex CLI.

Set OPEN_STUDIO_PORT to change the Studio port, or OPEN_STUDIO_CODEX_BIN to select a Codex executable. On Windows, the default executable is codex.exe.

~~~sh
npm test
~~~

Licensed under Apache-2.0.
