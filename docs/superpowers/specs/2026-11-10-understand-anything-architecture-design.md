# Backend architecture in Open Studio

## Intent

Give someone opening a backend folder a map of the code before they read individual files. The first example is the standalone Laravel backend at `D:\nwc-legal-dashboard\nwc-legal`. Opening a backend must work independently of a frontend folder or a running preview.

## What Studio shows

Add an **Architecture** workspace tab with three linked views.

- **Modules** starts with domain modules such as Lawsuit, Contract, and Notification, plus shared Laravel code. Label relationships by what the evidence supports, such as depends on, dispatches, or handles. Expand a module to see relevant files and links to source.
- **Business Lifecycles** starts on a module's main business path. For Lawsuit, expanding a stage reveals the individual approvals and alternate paths, including rejection and return for amendment where supported by the transition code. Show the actor or condition where the code establishes it. Follow a transition to its source. API request call chains are outside the first release.
- **System Design** shows the Laravel API, a generic client, and dependencies such as the database, queue workers, and external services when supported by project evidence. Distinguish configured or inferred connections from what the code directly establishes. The diagram describes the system visible from the selected folder. Live infrastructure inspection and frontend discovery are outside scope.

## Approaches considered

- **Integrate Understand Anything and render its graphs in Studio.** This reuses its dependency and business domain analysis and lets Studio control the level of detail, source navigation, and Git refresh. Studio takes on compatibility with the upstream output and fills in verified gaps. The user chose this approach, starting with the Lawsuit lifecycle.
- **Build a Laravel-first analyzer.** This gives Studio direct control over framework conventions, transition semantics, and evidence. It also requires Studio to own PHP analysis and develop new extractors for other stacks. Keep targeted Laravel extraction available where the upstream graphs lack evidence.

## Analyzer and storage

Use the upstream knowledge and domain graph formats as integration inputs, including both `.ua/` and the legacy `.understand-anything/`. Validate both inputs before adapting them to Studio's three views. The first release targets automatic generation for Laravel. Other backends with compatible saved graphs can open them in Studio. Keep the normalized graph, evidence, and freshness metadata in Studio's local cache, scoped to the selected folder and worktree. The feature leaves the project's Git configuration, hooks, and working files alone.

Analyze eligible files as they exist on disk, including saved local changes and non-ignored untracked source. Unsaved Studio edits enter the snapshot once saved. Use a fingerprint of the eligible files to associate Studio-generated graphs with that snapshot. For an imported graph with only a Git commit hash, require a matching commit and no eligible changes since that commit to consider it current. Display a stale indicator when freshness cannot be verified.

The design proposes a one-time generation opt-in per backend folder, consistent with Studio's existing Codex consent model. After opt-in, opening a folder without a usable graph starts generation. Opening it again shows the cached graph immediately. Generation uses the existing signed-in Codex setup through a separate, bounded job. Run the pinned upstream analysis against an isolated copy of the eligible source so its generated files stay out of the real project. Exclude credentials, `.env` files, dependencies, generated output, and local runtime data. Translate evidence paths back to verified paths inside the selected folder. Show a setup state if the skill or its runtime is unavailable. Viewing a valid saved graph works without an analysis run.

Test `$understand` and `$understand-domain` on Windows using `nwc-legal` before committing to the invocation design. Verify the upstream skills can run without an interactive dashboard or prompts inside Studio's job and that the domain output preserves enough evidence for Lawsuit. Try a thin invocation adapter if setup or dashboard launch is the only obstacle. If unattended generation still fails, bring the decision between a deeper adapter and a Laravel generator back for review. Import alone falls short of first-open generation and Git refresh.

If the upstream domain output gives a summary only, read Laravel status strategies, their callers, and relevant route and event definitions to ground the actual transitions. A status enum establishes which states exist. An assignment, strategy, or other explicit code path establishes a transition. Use the same evidence rule for database, queue, and external integration links. If a fact cannot be established, label it as inferred or omit it.

## Git refresh

Successful **Pull**, **Push**, and **Commit & Push** actions inside Studio request a freshness check when Git finishes. The design also proposes opt-in terminal integration on Windows so normal `git pull` and `git push` in a connected PowerShell session report successful completion. The bridge should preserve Git arguments, output, exit status, and interactivity and record only the repository identity and operation outcome required by Studio. A local marker lets Studio consume a successful event on next open if it was closed. Studio does not invoke the user's terminal Git operations itself.

In other terminals, check for observable changes to the checked-out revision and its upstream tracking ref while the folder is open, and recheck when it reopens. This is a freshness signal. A push that leaves no observable local ref change requires the terminal integration for an exact completion event. Git's `pre-push` hook runs before the outcome is known. [Git hooks reference](https://git-scm.com/docs/githooks)

Every received event checks the selected source snapshot. Reuse the graph if its inputs are unchanged. If analysis is needed, coalesce repeated events per workspace and keep the last valid graph visible while updating. Publish a complete replacement only after successful validation and a revision check. If another change arrives during generation, schedule another check. Show a recoverable stale or failed state with **Refresh** available. A failed Git operation must not be reported as a successful refresh trigger.

## First acceptance case

1. Open only `nwc-legal`. Studio shows an existing valid graph or starts generation after the one-time opt-in. The Architecture tab remains usable without a Vite preview or the Vue dashboard folder.
2. See Lawsuit, Legal Consultation, Contract, Notification, and shared Laravel code grouped as appropriate. Select a relationship and inspect its supporting source when available.
3. Open the Lawsuit lifecycle. See a readable main path, expand it to see approval and alternate branches, and verify representative transitions against the actual status strategies. Test a return-for-amendment branch as well as the normal path.
4. Open System Design and verify that the Laravel API, the database, and queued notification processing appear with evidence. Show the client as a generic boundary. Infrastructure that cannot be verified from the folder is identified as inferred if shown.
5. Close and reopen Studio and confirm the cached graph is available. Test successful and failed pulls and pushes from Studio and connected PowerShell using a disposable Git remote. Test an unchanged snapshot and a new change that arrives while analysis is running.

The implementation plan can choose the graph library, the cache schema, and the terminal event transport. Preserve the selected folder as the analysis boundary and link diagram claims to source wherever the evidence supports it.

## References

- [Understand Anything integration and graph artifacts](https://github.com/Egonex-AI/Understand-Anything#readme)
- [Understand Anything domain graph workflow](https://github.com/Egonex-AI/Understand-Anything/blob/main/understand-anything-plugin/skills/understand-domain/SKILL.md)
