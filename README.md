# PacedMind

A personal planner in the style of Linear: tasks, time blocks, one calendar and timeline for everything, and deadlines. It also coordinates Claude Code and Codex sessions: start a session from a task, keep talking to the agent in its own terminal, and see here when the agent says it's finished, with its report and screenshots.

## Desktop app

```bash
npm install
npm run desktop
```

This builds the app, installs it and starts it. Run the same command again after changing the code: it closes the running app, replaces it and starts the new version.

- **Windows:** it installs to `%LOCALAPPDATA%\Programs\Organizer` and adds **PacedMind** to the Start Menu and the desktop. Your data lives in `%APPDATA%\Organizer\data`.
- **macOS:** it installs `PacedMind.app` in the Applications folder of your home folder (`~/Applications`). Your data lives in `~/Library/Application Support/Organizer/data`.
- The data is kept when you reinstall. The first start has just the default areas.
- Closing the window keeps PacedMind running in the tray (the menu bar on macOS), so agents can still report back. It shows a notification when a session finishes. Quit from the icon's menu, which also has **Start with Windows** (**Open at Login** on macOS).
- The app serves itself at http://127.0.0.1:4319. Only this computer can reach it.
- To uninstall on Windows, run `Organizer.exe --uninstall` from the install folder (removes the shortcuts and the login item), then delete the folder. On macOS, turn off **Open at Login** and move `PacedMind.app` to the Bin. Delete the data folder to remove your data as well.

## Releases

The site's download buttons lead to `pacedmind.com/download/windows` and `/download/mac`. `npm run release` builds the installer for the system it runs on and uploads it there (`scripts/release.mjs`); run it on a PC and on a Mac:

```bash
npm run release -- ubuntu@57.131.192.185   # build, package and upload
npm run release -- --no-upload             # only build and package, into dist/release
```

- **Windows:** `PacedMind-Windows.exe`, an installer made with electron-builder. It installs for the current user where `npm run desktop` does, closes a running PacedMind first and keeps the data. It isn't signed, so SmartScreen asks once before it runs.
- **macOS:** `PacedMind-macOS.dmg`, one app for Apple silicon and Intel, signed with your Developer ID and notarized by Apple, the disk image too. Once, on the Mac: put your **Developer ID Application** certificate in the login keychain (Xcode → Settings → Accounts → Manage Certificates), and store the notarization credentials under the name `PacedMind` with `xcrun notarytool store-credentials PacedMind --apple-id <your Apple ID> --team-id <your team ID>` (it asks for an app-specific password from account.apple.com). Both stay in the keychain. `PACEDMIND_SIGN_IDENTITY` picks a certificate if there are several, and `PACEDMIND_NOTARY_PROFILE` another profile name.
- The upload uses the SSH key `deploy/deploy.sh` uses (`PACEDMIND_KEY`, by default `~/Desktop/keys/pacedmind_vps`; on the Mac, copy it there and `chmod 600` it) and keeps the previous file on the server as `<name>.old`.

## Development

```bash
npm run dev
```

Open http://127.0.0.1:4320. The dev server uses its own database, `data/organizer.db`, created with sample data on first start, so it never touches the app's data. Press **C** anywhere to add a task.

## Website

The public home page is in `site/`, a separate static Next.js project with its own dependencies. See [site/README.md](site/README.md), including how to keep the Cloud price in step with Spotify.

## Documentation

The user guide is in `docs/`, a separate static Fumadocs site served at pacedmind.com/docs, with its own dependencies. See [docs/README.md](docs/README.md).

## Agents and MCP

The MCP server runs at `http://127.0.0.1:4319/api/mcp` in the desktop app (`4320` for the dev server) and needs the access token shown in **Settings → MCP server**.

- Sessions started from PacedMind (the **Start in Claude Code** button on a task) are connected automatically. PacedMind opens a terminal in the project's folder with Claude Code, the task and the MCP config: a Windows Terminal tab or a Command Prompt window on Windows, a Terminal or iTerm window on macOS (**Settings → Starting sessions**).
- To use PacedMind from Claude Code sessions you start yourself, run `npm run connect` once. It registers the MCP server as `organizer` for all your projects, using the app's token; `npm run connect -- --remove` undoes it. The `claude mcp add …` command in Settings does the same by hand.
- For Codex, copy the `config.toml` snippet from Settings.

Set each project's folder in **Settings → Projects and folders**. Flows only start sessions on their own when the project's **Flow** switch is on.

The MCP tools cover the whole app:
- areas and projects;
- tasks, with descriptions, "Done when" lists, sub-tasks, priorities, due and planned dates, and labels;
- calendar events, and moving plans between days;
- the agenda with its auto-planned focus blocks, and work hours;
- agent flows and sessions, and the reports agents hand back.

Dates can be written as `YYYY-MM-DD` or as phrases like "friday 10:00". In sessions started from PacedMind, agents can read, add and update tasks without asking. Deleting things, moving calendar events and starting sessions ask in the agent's terminal first.

### Skills

`skills/` holds agent skills that teach Claude Code and Codex how to use these tools well:

- `pacedmind`: the basics.
- `pacedmind-planning`: plan a day or week, move things.
- `pacedmind-projects`: break a project down, set up agent flows.
- `pacedmind-review`: Inbox triage, the weekly review.
- `pacedmind-agent-session`: the start_task / finish_task protocol for agents working on a task, including the report and screenshots.

```bash
npm run skills
```

This installs them in `~/.claude/skills` and, when Codex is installed, in `~/.codex/skills`. Run it again after changing them. `npm run skills -- --remove` uninstalls them.

## Reports from agents

A task's **Done when** list says what must be true when it's finished, one checkable outcome per line. Add it in the task panel, or with the Done when chip when you create a task.

When an agent hands a task back, `finish_task` carries a report: a summary, a verdict (met, partly or not met) for each Done when item, screenshots, how to check the result, questions for you, and details in Markdown. Open the task, or the session in Sessions, to see it, and click a screenshot to see it full size. An agent that hands back only part of the work (partial) or gets stuck (blocked) holds its flow: nothing after it starts until you mark the task done.

If it isn't right yet, press **Request changes** under the report and write what should change. (Sessions in the Claude or Codex app, or in the cloud, take changes where they run.) The session reopens in a new terminal tab: Claude Code continues its conversation (as a new branch of it, so the old tab doesn't get in the way), and Codex starts a new one that reads its report and your changes. Either way the agent hands the task back with a new report, and the arrows on the report page through earlier ones.

Agents attach screenshots by saving an image file and passing its path (`attach_image`, or `images` in `finish_task`). PacedMind checks that it's a PNG, JPEG, GIF or WebP of up to 20 MB and keeps a copy in `attachments/` next to the database. Deleting the task deletes its images.

## Views

Today, Inbox, Upcoming, Calendar (month and week with auto-planned time blocks), Timeline, Projects, Roadmap and Flow (two views of one plan), Sessions, Settings. Pages refresh on their own when an agent changes something.

Switch between dark and light mode beside Settings in the sidebar, or in **Settings → Appearance**. The choice is remembered on this device and also updates the Windows title-bar controls.

## Brand assets

The refined wordmark (with continuous m and n curves) and solid connected **pd** emblem are saved in `public/brand/`. The compact 112px header logo, beside the back/forward controls, unfolds from pd into pacedmind on initial load (with a reduced-motion fallback). On Windows the header replaces the native title text, keeps native minimize/maximize/close controls and supports dragging the window. On macOS the traffic lights sit in the same header. The loading screen uses the same header; the emblem is used for the Windows executable, tray, notifications and favicon, and for the macOS app icon (`desktop/icon.icns`, on Apple's icon grid). The macOS menu bar shows the pd glyph alone, as a template image macOS tints for light and dark (`desktop/trayTemplate.png`). Run `npm run icons` to regenerate the emblem's SVG and icon exports.

The existing `Organizer` installation directory, executable name, data directory and MCP identifiers are intentionally retained so upgrades preserve integrations and data. The app and shortcuts display **PacedMind**.
