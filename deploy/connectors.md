# ChatGPT and Claude directory submission

Prepared 30 September 2026. This is the review package for PacedMind's existing remote MCP server. No directory submission or production OAuth review has been completed by preparing these files.

## Listing fields

| Field | Value |
| --- | --- |
| Name | PacedMind |
| Short description | Plan your tasks, projects and calendar with your AI assistant. |
| Category | Productivity / task management |
| Website | https://pacedmind.com |
| Setup and support | https://pacedmind.com/docs/mcp/connect-cloud |
| Privacy | https://pacedmind.com/privacy |
| Terms | https://pacedmind.com/terms |
| Support email | mbednarczyk@preseed.tech |
| MCP URL (Universal) | https://app.pacedmind.com/api/mcp |
| Transport | Streamable HTTP, remote |
| Authentication | OAuth authorization code + PKCE, Supabase dynamic client registration |
| Resource metadata | https://app.pacedmind.com/.well-known/oauth-protected-resource/api/mcp |
| Assets | Approved emblem and icons in `public/brand/`; select the portal's requested sizes without changing the archived original |

Suggested full description: “Bring your day into the conversation. See upcoming work, create tasks with deadlines and subtasks, organize projects, and reschedule your calendar in PacedMind. Connect your own Cloud account and approve access in your browser. Planning works before you set up an authenticator. Starting agent sessions or requesting folder changes on your computers requires two-factor sign-in, a connection approved with it, and the computer's own permission settings.”

## Review accounts and examples

Create a dedicated, email-confirmed review account with synthetic data and no authenticator. Keep it able to write throughout review (an active subscription or operator-managed test entitlement). Never put its password in this repository: enter credentials only in the review portal. This account demonstrates planning and the computer-control refusal; it cannot demonstrate enabled computer control. To include that capability in review, arrange a separate reviewer-accessible MFA-enabled test account and test computer with the reviewer through the portal. Do not bypass MFA for reviewers.

Seed an area named Review (`REV`), a project named Launch, two unfinished tasks planned for tomorrow, a 30-minute task, and a calendar event named Team check-in tomorrow at 10:00. Record the resulting task keys. The examples below are the acceptance cases to execute in both hosts, with the review account, after deployment. **Execution status: pending live OAuth tests.**

| Positive case | Prompt | Expected tools and result |
| --- | --- | --- |
| Overview | What is on my plate in PacedMind? | `get_overview`; only the review account's areas, projects and tasks |
| Capture | Add “Prepare launch notes” in Launch for tomorrow, 30 minutes. | `get_overview`, `create_task`; one task, correct project, planned date and estimate |
| Find | Show unfinished tasks in Launch. | `list_tasks` or `get_project`; only matching open tasks |
| Edit | Change that launch-notes task to high priority and add “Include install instructions” to its description. | `update_task`; correct existing task, description retained and appended |
| Calendar | Move Team check-in to the next day at the same time. | `list_events`, `update_event`; one event moved, duration retained |

| Negative case | Prompt / setup | Expected result |
| --- | --- | --- |
| Ambiguous deletion | Delete the old task (with multiple plausible matches). | Ask which task; no deletion until the user identifies and authorizes it |
| Restricted computer control | Start an agent session on my computer, using the account without MFA. | `start_session` returns setup/reconnect guidance; no launch request or process |
| Revoked connection | Disconnect the review agent in PacedMind Settings → Connected agents, then ask for tasks. | Protected request rejected and reconnect offered; no planner data |

Also verify sign-out, account isolation, invalid inputs, expiration/refresh, safe behavior on embedded instructions in task descriptions, and the metadata scan. `node --conditions=react-server --import tsx --test tests/connector-contract.test.ts` verifies the published tool descriptors and domain challenge locally; it does not test hosted OAuth.

## OpenAI

Use the remote MCP submission path in the [submission portal guide](https://developers.openai.com/plugins/deploy/submission). The owning organization needs Apps Management write access. Choose Universal URL and OAuth. Complete the portal's domain challenge by setting `ORGANIZER_OPENAI_APPS_CHALLENGE` on the hosted app to its exact token and restarting the service. The public route returns only that token, and 404 when unset. Do not replace another listing's proof token at the same URL.

Upload the listing assets, supply reviewer credentials privately, record an accessible walkthrough of the five positive and three negative cases, and provide release notes. Review every discovered tool's annotations in the portal. The hosted server emits per-tool OAuth declarations in both `securitySchemes` and the `_meta.securitySchemes` compatibility mirror; the contract test verifies the actual wire response.

Production OAuth must be tested against [OpenAI's authentication requirements](https://developers.openai.com/plugins/build/auth), including issuer, S256, refresh, resource audience binding and the actual callback issued for this connection. Supabase's discovery is forwarded unchanged; do not claim it supports CIMD, RFC 9207 or resource audiences merely by adding metadata. Check the deployed provider, token contents and authorization enforcement. Record and resolve any compatibility gap before submission. No invented planner scopes or client secrets are required by this server.

## Claude

Use the single remote MCP connector path in Claude's [developer submission portal](https://claude.com/blog/build-plugins-for-claude). Submit the public HTTPS endpoint, the same listing and support links, test credentials, and the working examples above. Meet the [Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy): secure OAuth, clear privacy information, tested tool metadata, endpoint ownership and a maintained support channel.

## Remaining release evidence

- Deploy this revision and its database migration together after the normal landing and security checks.
- Verify custom connections end to end in both ChatGPT and Claude; test MFA setup followed by reconnect separately.
- Confirm privacy/support URLs, logo assets and the exact tool scan in each portal.
- Supply actual reviewer accounts, a walkthrough recording, publishing account verification and portal-issued domain proof.
- Obtain each directory's approval, then replace custom-connection onboarding with the real listing link. Do not invent a directory URL or advertise approval in advance.

Source requirements were checked on 30 September 2026. Portal fields and account eligibility can change; use the linked official guides at submission time.
