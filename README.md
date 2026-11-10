# Open Studio

Open Studio is a local development workspace for editing Vue projects with Codex. Open a local folder or Git repository, edit the original files, and use Source Control to review, commit, and push changes.

## Windows desktop app

Run the Windows x64 setup executable, then launch **Open Studio** from the Start menu. The desktop app bundles its own runtime and starts the local Studio server automatically.

Vue previews use Node.js and npm on your PATH and the project's installed dependencies. Source Control uses Git, and the Page agent uses the Codex CLI signed in with `codex login`.

From a Windows checkout with Node.js 24+ and npm, use `npm ci` followed by `npm run desktop` to launch Electron locally, or `npm run package:win` to build the installer in `release/`.

## Run in a browser

Requirements: Node.js 24+, npm, Git for Source Control, and the Codex CLI signed in with `codex login`. Start any backend service your Vue app normally uses before opening its preview.

~~~sh
npm ci
npm run build
npm start
~~~

Open <http://localhost:4320> and select **Open Folder**. The folder chooser opens on the desktop running Open Studio and requires Zenity on Linux. For a trusted Vue/Vite project with installed dependencies, select **Start preview** to run its npm dev command in the original folder.

Use **Select element** in the preview toolbar, then click an element. Studio uses Vue's development metadata to find the owning component when available. Use Explorer to select a Vue file manually. In **Page agent**, approve sharing project context and messages with Codex. The agent can prepare changes across several files. For shared-component edits, Studio lists the routes it can trace and waits for approval. Source saves and applied Codex edits update the original files directly.

Open **Source Control** or **Diff** to see staged, unstaged, and untracked files across the repository. Select a file to review its diff. Use **+** to stage or **−** to unstage, enter a message, and choose **Commit** or **Commit & Push**. Use **Push** to send existing commits. Studio uses your Git credentials and the current branch's upstream. For a branch without an upstream, Studio uses `origin` or the sole configured remote and sets the upstream on success.

Use the branch picker at the top of **Source Control** to switch to a local branch or check out a fetched remote branch with tracking. **Pull** updates the current branch from its upstream when it can fast-forward. Save any unsaved editor changes before switching or pulling.

## Browse a MySQL database

Open **Database**, enter your MySQL connection details, and select **Connect**. Use the table filter to find a table and preview up to 50 rows. Select an editable cell, enter a value or choose **Set to NULL**, then select **Save cell**.

Cell editing requires an InnoDB table with a supported primary key and MySQL UPDATE permission for the column. Primary keys, generated columns, binary values, and truncated previews are read-only. Studio checks the original cell value before saving to catch concurrent changes.

Select **Require verified TLS** if your server uses a certificate trusted by Studio's Node runtime. Studio clears the password when you disconnect or close Studio.

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
