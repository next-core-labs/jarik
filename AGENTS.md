<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep `/hq` as the platform team's separate workspace: authorize the super-admin or a delegated `hq_admins` permission in the authenticated route gate, and show only platform navigation there; office admin status alone never grants access.
- Generate public listing and office JSON-LD from the same published page data in leaf route heads so search metadata cannot disclose private or stale records.
