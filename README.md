# Open Studio

Open Studio is a local development workspace for editing Vue and React projects with Codex and exploring Laravel and NestJS backends. Open a local folder or Git repository, edit the original files, and use Source Control to review, commit, and push changes.

## Windows desktop app

Run the Windows x64 setup executable, then launch **Open Studio** from the Start menu. The desktop app bundles its own runtime and starts the local Studio server automatically.

Vue and React previews use Node.js and npm on your PATH and the project's installed dependencies. Source Control uses Git, and the Page agent uses the Codex CLI signed in with `codex login`.

From a Windows checkout with Node.js 24+ and npm, use `npm ci` followed by `npm run desktop` to launch Electron locally, or `npm run package:win` to build the installer in `release/`.

## Run in a browser

Requirements: Node.js 24+, npm, Git for Source Control, and the Codex CLI signed in with `codex login`. Start any backend service your frontend normally uses before opening its preview.

~~~sh
npm ci
npm run build
npm start
~~~

Open <http://localhost:4320> and select **Open Folder**. The folder chooser opens on the desktop running Open Studio and requires Zenity on Linux. For a trusted Vue or React project with installed dependencies and a Vite `npm run dev` script, select **Start preview** to run the command in the original folder.

Use **Select element** in the preview toolbar, then click an element. Studio uses Vue or React development metadata to find the owning source when available. Use Explorer to select the source file manually. In **Page agent**, approve sharing project context and messages with Codex. The agent can prepare changes across several files. For shared-component edits, Studio lists the routes it can trace and waits for approval. Source saves and applied Codex edits update the original files directly.

Open **Source Control** or **Diff** to see staged, unstaged, and untracked files across the repository. Select a file to review its diff. Use **+** to stage or **−** to unstage, enter a message, and choose **Commit** or **Commit & Push**. Use **Push** to send existing commits. Studio uses your Git credentials and the current branch's upstream. For a branch without an upstream, Studio uses `origin` or the sole configured remote and sets the upstream on success.

Use the branch picker at the top of **Source Control** to switch to a local branch or check out a fetched remote branch with tracking. **Pull** updates the current branch from its upstream when it can fast-forward. Save any unsaved editor changes before switching or pulling.

If a push is rejected because the remote branch has new commits, choose **Merge & Push** in **Source Control**. Studio fetches and merges the remote branch, then retries the push. If Git reports conflicts, resolve and stage the files, commit the merge, and push again. **Abort Merge** discards work done to resolve the merge. To review the merge before pushing, choose **Merge from Remote** under **More Git actions**.

**Local Commit Changes** shows file changes in local commits since the branch diverged from its last fetched upstream. Use the undo button on a file to create an unstaged reversal, then review, stage, and commit it. The original commits remain in the branch history.

## Explore backend architecture

Open a Laravel folder to generate its **Architecture** views from local source. Use **Modules** to explore dependencies, **Business Lifecycles** to expand approval paths and branches, and **System Design** to see the API and its integrations. Select a node or relationship to inspect its supporting code.

Open a NestJS folder directly or choose **Link Backend** from a frontend workspace. Studio maps `@Module` declarations, statically resolvable imports, and registered controllers and providers to their source. Saved Understand Anything domain graphs can supply business lifecycles.

Studio can read existing [Understand Anything](https://github.com/Egonex-AI/Understand-Anything#readme) graphs in `.ua/` or `.understand-anything/`. To generate them through Codex, install the `understand` and `understand-domain` skills and choose **Enable AI analysis**. Studio asks for consent before sending eligible source from the folder to Codex.

Studio checks for changes after a successful pull or push. To report successful terminal actions even when they leave local refs unchanged, select **Connect PowerShell** and run the displayed command in each terminal session you want to connect.

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
- The frontend runs from the open folder. Use projects whose dev scripts you trust. The frontend can use its own running backend.
- The Codex CLI resumes a session in the open folder using read-only tools. Studio validates its proposed text edits before applying them. Studio traces supported Vue router definitions and local component imports. React route impact starts from the app's home entry and follows static imports.
- Studio stores chat state under `~/.open-studio/drafts` by default. Use `OPEN_STUDIO_DRAFTS_DIR` to choose another location. SSO providers that block embedding may need a separate browser tab.
- GitHub distributes the source. The working app needs the local Node server and Codex CLI.

Set OPEN_STUDIO_PORT to change the Studio port, or OPEN_STUDIO_CODEX_BIN to select a Codex executable. On Windows, the default executable is codex.exe.

~~~sh
npm test
~~~

Licensed under Apache-2.0.
