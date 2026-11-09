# Open Studio

Open Studio is a local development workspace for editing Vue projects with Codex. Import a Vue/Vite frontend, select a page or component in the live preview, and discuss a change. Review the draft and publish it back to the original folder.

## Run locally

Requirements: Node.js 24+, npm, and the Codex CLI signed in with codex login. Start any backend service your Vue app normally uses before opening its preview.

~~~sh
npm ci
npm run build
npm start
~~~

Open <http://localhost:4320>. Open **Import Vue project**, then use **Choose folder** to select a trusted frontend folder with installed dependencies. The folder chooser opens on the desktop running Open Studio and requires Zenity on Linux. Create the private draft, approve its npm dev command, then browse the preview. If the preview port is occupied, close the draft and choose another port on import.

Import copies the frontend source first. Preview startup links the project's installed dependencies. If the draft is on a different Windows drive or Studio can't create the link, it copies the packages and shows progress in the status bar.

Use **Select element** in the preview toolbar, then click an element. Studio uses Vue's development metadata to find the owning component when available. Use Explorer to select a file manually. In **Page agent**, approve sharing draft context and messages with Codex, then discuss a change or request an installed skill such as `$brainstorming`. The agent can prepare changes across several files. For shared-component edits, Studio lists the routes it can trace and waits for approval.

Open **Source Control** or **Diff** to browse staged, unstaged, and untracked files in the imported folder. Select a file to open its diff in the editor. To apply private draft edits, check the live preview and open **Publish** to review the files. If Studio flags a conflict, use **Resolve conflict** to merge the draft with the current original or keep the original. Confirm your review and select **Publish to original folder** to apply the changes. Closing the draft stops its dev server. Import the same folder later to resume the draft and chat.

## Signal design system

Open Studio uses warm graphite surfaces with lime for the current file, focused controls, and primary actions. Git additions use fern, deletions use rose, and warnings use amber. File status letters, line markers, and focus outlines make those states readable without relying on color alone.

`src/theme.css` is the source of truth. Palette values feed semantic roles such as `--ground`, `--accent`, and `--success`. The editor and file selectors use component tokens that inherit those roles. Use the shared UI and code fonts, spacing, and radii for new controls. Keep the browser chrome color in `index.html` aligned with the shell token.

## How it works

For React development with Fast Refresh, run `npm run dev` and open
<http://localhost:4321>. The Codex and workspace API runs on the same
address, so there is no second server to start.

- React and Vite build the interface. The Node server serves it on loopback.
- The frontend runs from a private copy on your computer. Use projects whose dev scripts you trust. The frontend can use its own backend, including an already running Laravel API. Linked dependencies are shared with the original project.
- The Codex CLI resumes a session in the draft using read-only tools. Studio validates its proposed text edits before applying them. Route impact is inferred from statically recognized router definitions and Vue imports.
- Studio stores drafts under `~/.open-studio/drafts` by default. Use `OPEN_STUDIO_DRAFTS_DIR` to choose another location. SSO providers that block embedding may need a separate browser tab.
- GitHub distributes the source. The working app needs the local Node server and Codex CLI.

Set OPEN_STUDIO_PORT to change the Studio port, or OPEN_STUDIO_CODEX_BIN to select a Codex executable. On Windows, the default executable is codex.exe.

~~~sh
npm test
~~~

Licensed under Apache-2.0.
