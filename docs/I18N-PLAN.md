# UI translation work plan

Four disjoint source-file ownership groups. Counts estimate remaining visible string **occurrences**, not unique catalog keys: JSX text, UI attributes, label fields and likely Norwegian literals. Review each file in context; zero is an estimate, not proof. The five reference screens, locale infrastructure/catalogs, generated assets, icons, declarations, tests and system profiles are outside these assignments. CSS is included for generated content. Each agent owns only the files listed in its group. Submit new translations as a separate key/value fragment per group for the integration owner to combine into the canonical catalogs. Do not edit another group’s files; report cross-area dependencies.

## Group 1: Composer and commands — 979 strings

### Composer and commands (314)

| File | Estimate |
| --- | ---: |
| `web/src/state/composer-delivery.ts` | 0 |
| `web/src/ui/AnswerModel.tsx` | 6 |
| `web/src/ui/ChatToolMenu.tsx` | 13 |
| `web/src/ui/CommandList.tsx` | 7 |
| `web/src/ui/Composer.tsx` | 245 |
| `web/src/ui/Dictation.tsx` | 21 |
| `web/src/ui/slash-code.ts` | 4 |
| `web/src/ui/slash-thread.ts` | 18 |

### Skills, search and shortcuts (578)

| File | Estimate |
| --- | ---: |
| `web/src/lib/skill-workspace.ts` | 2 |
| `web/src/state/shortcuts.ts` | 29 |
| `web/src/ui/CommandPalette.tsx` | 78 |
| `web/src/ui/MenuBar.tsx` | 57 |
| `web/src/ui/SkillsRoom.tsx` | 100 |
| `web/src/ui/TokenTooltip.tsx` | 3 |
| `web/src/ui/Tooltip.tsx` | 0 |
| `web/src/ui/settings/search.ts` | 189 |
| `web/src/ui/settings/shortcuts.tsx` | 31 |
| `web/src/ui/settings/skill-import.tsx` | 15 |
| `web/src/ui/settings/skills.tsx` | 74 |

### App layout and dialogs (87)

| File | Estimate |
| --- | ---: |
| `web/src/ui/App.tsx` | 6 |
| `web/src/ui/ContextMenu.tsx` | 0 |
| `web/src/ui/GridView.tsx` | 4 |
| `web/src/ui/Pane.tsx` | 7 |
| `web/src/ui/Popover.tsx` | 0 |
| `web/src/ui/Scheduled.tsx` | 27 |
| `web/src/ui/SecretInput.tsx` | 2 |
| `web/src/ui/Select.tsx` | 1 |
| `web/src/ui/dialog-state.ts` | 0 |
| `web/src/ui/dialogs.tsx` | 40 |

## Group 2: Agent turns and approvals — 1013 strings

### Agent turns and approvals (366)

| File | Estimate |
| --- | ---: |
| `web/src/state/thread-model-selection.ts` | 0 |
| `web/src/state/thread-model.ts` | 0 |
| `web/src/state/thread-status.ts` | 0 |
| `web/src/ui/BtwPanel.tsx` | 16 |
| `web/src/ui/Conversation.tsx` | 40 |
| `web/src/ui/Goal.tsx` | 11 |
| `web/src/ui/MemoryReview.tsx` | 15 |
| `web/src/ui/PermissionPicker.tsx` | 20 |
| `web/src/ui/PinnedSummary.tsx` | 44 |
| `web/src/ui/SessionPanel.tsx` | 29 |
| `web/src/ui/UserQuestion.tsx` | 13 |
| `web/src/ui/babysit.ts` | 22 |
| `web/src/ui/permission-copy.ts` | 0 |
| `web/src/ui/rows.tsx` | 87 |
| `web/src/ui/step-words.ts` | 44 |
| `web/src/ui/steps.tsx` | 25 |

### Editor and project management (292)

| File | Estimate |
| --- | ---: |
| `web/src/state/project-actions.ts` | 7 |
| `web/src/state/project-picker.ts` | 0 |
| `web/src/state/studio.ts` | 0 |
| `web/src/studio/StudioFiles.tsx` | 74 |
| `web/src/studio/StudioWorkspace.tsx` | 30 |
| `web/src/studio/editor.ts` | 1 |
| `web/src/studio/files.css` | 0 |
| `web/src/studio/workspace.css` | 0 |
| `web/src/styles/project-creation.css` | 0 |
| `web/src/styles/project-picker.css` | 0 |
| `web/src/ui/EditProject.tsx` | 32 |
| `web/src/ui/FolderMissingBar.tsx` | 9 |
| `web/src/ui/MiniEditor.tsx` | 68 |
| `web/src/ui/MiniEditorHooks.tsx` | 3 |
| `web/src/ui/ProjectCreationDialog.tsx` | 28 |
| `web/src/ui/ProjectEnvironmentPicker.tsx` | 12 |
| `web/src/ui/ProjectGlyph.tsx` | 0 |
| `web/src/ui/ProjectSettings.tsx` | 28 |

### Chat projects and tools (239)

| File | Estimate |
| --- | ---: |
| `web/src/state/chat-personality.ts` | 0 |
| `web/src/styles/chat-projects.css` | 0 |
| `web/src/ui/ChatFileCards.tsx` | 2 |
| `web/src/ui/ChatProjectDialog.tsx` | 32 |
| `web/src/ui/ChatProjectGlyph.tsx` | 0 |
| `web/src/ui/ChatProjectMemories.tsx` | 23 |
| `web/src/ui/ChatProjectPage.tsx` | 28 |
| `web/src/ui/ChatTools.tsx` | 23 |
| `web/src/ui/chat-projects.ts` | 3 |
| `web/src/ui/settings/chat-personal.tsx` | 59 |
| `web/src/ui/settings/memory-upgrade.tsx` | 5 |
| `web/src/ui/settings/memory.tsx` | 64 |

### Themes and wallpapers (65)

| File | Estimate |
| --- | ---: |
| `web/src/lib/theme.ts` | 0 |
| `web/src/lib/ui-mod-theme.ts` | 0 |
| `web/src/state/themes.ts` | 17 |
| `web/src/state/ui-mods.ts` | 3 |
| `web/src/styles/ui-mods.css` | 0 |
| `web/src/ui/GlobalWallpaper.tsx` | 0 |
| `web/src/ui/Nordlys.tsx` | 3 |
| `web/src/ui/UiModBackdrop.tsx` | 0 |
| `web/src/ui/UiModBand.tsx` | 1 |
| `web/src/ui/UiModRoot.tsx` | 0 |
| `web/src/ui/UiModsDialog.tsx` | 41 |

### Shared state and utilities (51)

| File | Estimate |
| --- | ---: |
| `web/src/lib/api.ts` | 1 |
| `web/src/lib/app-icon.ts` | 0 |
| `web/src/lib/diff.ts` | 0 |
| `web/src/lib/focus.ts` | 0 |
| `web/src/lib/format.ts` | 1 |
| `web/src/lib/frame.ts` | 0 |
| `web/src/lib/outline.ts` | 1 |
| `web/src/lib/resize.ts` | 0 |
| `web/src/lib/sequence.ts` | 0 |
| `web/src/lib/socket.ts` | 0 |
| `web/src/lib/terminal-share.ts` | 5 |
| `web/src/lib/visible.ts` | 0 |
| `web/src/lib/warm-glyphs.ts` | 0 |
| `web/src/main.tsx` | 1 |
| `web/src/state/actions.ts` | 13 |
| `web/src/state/app.ts` | 4 |
| `web/src/state/artifacts.ts` | 0 |
| `web/src/state/clock.ts` | 0 |
| `web/src/state/downloads.ts` | 1 |
| `web/src/state/drag.ts` | 4 |
| `web/src/state/fork.ts` | 0 |
| `web/src/state/grid.ts` | 2 |
| `web/src/state/history.ts` | 0 |
| `web/src/state/home.ts` | 0 |
| `web/src/state/hooks.ts` | 0 |
| `web/src/state/look.ts` | 0 |
| `web/src/state/mcp.ts` | 0 |
| `web/src/state/message-jump.ts` | 0 |
| `web/src/state/servers.ts` | 3 |
| `web/src/state/skills-workspace.ts` | 0 |
| `web/src/state/startup.ts` | 0 |
| `web/src/styles.css` | 0 |
| `web/src/styles/annotation-polish.css` | 0 |
| `web/src/styles/browser-polish.css` | 0 |
| `web/src/styles/chat-files.css` | 0 |
| `web/src/styles/chat.css` | 0 |
| `web/src/styles/code-appearance.css` | 0 |
| `web/src/styles/cookies.css` | 0 |
| `web/src/styles/design.css` | 0 |
| `web/src/styles/extra.css` | 0 |
| `web/src/styles/git-workspace.css` | 0 |
| `web/src/styles/grid.css` | 0 |
| `web/src/styles/harness.css` | 0 |
| `web/src/styles/hooks.css` | 0 |
| `web/src/styles/kode.css` | 0 |
| `web/src/styles/local-files.css` | 0 |
| `web/src/styles/local-panel-context.css` | 0 |
| `web/src/styles/mcp.css` | 0 |
| `web/src/styles/model-context.css` | 0 |
| `web/src/styles/motion.css` | 0 |
| `web/src/styles/nordlys.css` | 0 |
| `web/src/styles/panel-workspace.css` | 0 |
| `web/src/styles/permissions.css` | 0 |
| `web/src/styles/pinned-summary.css` | 0 |
| `web/src/styles/queue.css` | 0 |
| `web/src/styles/response-selection.css` | 0 |
| `web/src/styles/runde11.css` | 0 |
| `web/src/styles/runde11b.css` | 0 |
| `web/src/styles/runde12a.css` | 0 |
| `web/src/styles/runde13.css` | 0 |
| `web/src/styles/runde14.css` | 0 |
| `web/src/styles/runde15.css` | 0 |
| `web/src/styles/session-panel.css` | 0 |
| `web/src/styles/settings-polish.css` | 0 |
| `web/src/styles/settings.css` | 0 |
| `web/src/styles/side-questions.css` | 0 |
| `web/src/styles/skills-room.css` | 0 |
| `web/src/styles/stack.css` | 0 |
| `web/src/styles/terminal-share.css` | 0 |
| `web/src/styles/user-question.css` | 0 |
| `web/src/styles/window-controls.css` | 0 |
| `web/src/ui/FileChangeCounts.tsx` | 5 |
| `web/src/ui/Motion.tsx` | 0 |
| `web/src/ui/icons.tsx` | 0 |
| `web/src/ui/lazy-views.ts` | 0 |
| `web/src/ui/nav-icons.tsx` | 10 |

## Group 3: Settings — 977 strings

### Settings (864)

| File | Estimate |
| --- | ---: |
| `web/src/ui/AppIconPicker.tsx` | 6 |
| `web/src/ui/ChromeImport.tsx` | 20 |
| `web/src/ui/CookieImport.tsx` | 79 |
| `web/src/ui/DownloadsList.tsx` | 24 |
| `web/src/ui/ThemePicker.tsx` | 3 |
| `web/src/ui/settings/code-appearance.tsx` | 40 |
| `web/src/ui/settings/harness.tsx` | 114 |
| `web/src/ui/settings/hooks.tsx` | 92 |
| `web/src/ui/settings/local-model-advisor.tsx` | 33 |
| `web/src/ui/settings/mcp.tsx` | 68 |
| `web/src/ui/settings/model-context.tsx` | 25 |
| `web/src/ui/settings/modes.tsx` | 72 |
| `web/src/ui/settings/parts.tsx` | 2 |
| `web/src/ui/settings/providers.tsx` | 159 |
| `web/src/ui/settings/storage.tsx` | 68 |
| `web/src/ui/settings/usage.tsx` | 36 |
| `web/src/ui/settings/wallpaper.tsx` | 23 |

### Git and GitHub (113)

| File | Estimate |
| --- | ---: |
| `web/src/ui/GitHubPanel.tsx` | 34 |
| `web/src/ui/GitHubSettings.tsx` | 25 |
| `web/src/ui/GitHubShared.tsx` | 7 |
| `web/src/ui/GitWorkspace.tsx` | 47 |

## Group 4: Side panels — 967 strings

### Side panels (327)

| File | Estimate |
| --- | ---: |
| `web/src/panels/Annotate.tsx` | 48 |
| `web/src/panels/Browser.tsx` | 86 |
| `web/src/panels/Changes.tsx` | 20 |
| `web/src/panels/FileTree.tsx` | 1 |
| `web/src/panels/Files.tsx` | 14 |
| `web/src/panels/LocalFiles.tsx` | 24 |
| `web/src/panels/Overview.tsx` | 50 |
| `web/src/panels/Team.tsx` | 13 |
| `web/src/panels/Terminal.tsx` | 13 |
| `web/src/panels/browser-address.ts` | 0 |
| `web/src/panels/browser-native.ts` | 0 |
| `web/src/panels/editor.ts` | 0 |
| `web/src/panels/html-editor.ts` | 0 |
| `web/src/state/annotate.ts` | 0 |
| `web/src/state/panel-sessions.ts` | 0 |
| `web/src/state/panel.ts` | 0 |
| `web/src/state/stack.ts` | 0 |
| `web/src/ui/LocalPanelContext.tsx` | 16 |
| `web/src/ui/PanelStack.tsx` | 18 |
| `web/src/ui/RightPanel.tsx` | 10 |
| `web/src/ui/panel-content.tsx` | 14 |
| `web/src/ui/panel-tools.tsx` | 0 |

### Navigation and threads (396)

| File | Estimate |
| --- | ---: |
| `web/src/state/archive.ts` | 5 |
| `web/src/state/nav.ts` | 0 |
| `web/src/state/navigate.ts` | 0 |
| `web/src/state/thread-actions.ts` | 18 |
| `web/src/styles/nav.css` | 0 |
| `web/src/ui/Home.tsx` | 70 |
| `web/src/ui/HoverCard.tsx` | 22 |
| `web/src/ui/ProfilePage.tsx` | 27 |
| `web/src/ui/Sidebar.tsx` | 175 |
| `web/src/ui/SmartSidebar.tsx` | 41 |
| `web/src/ui/ThreadMenu.tsx` | 31 |
| `web/src/ui/sidebar-sections.tsx` | 7 |

### Artifacts and markdown (142)

| File | Estimate |
| --- | ---: |
| `web/src/markdown/artifact-card.ts` | 6 |
| `web/src/markdown/artifact-detect.ts` | 0 |
| `web/src/markdown/chart.ts` | 1 |
| `web/src/markdown/highlight.ts` | 0 |
| `web/src/markdown/math.ts` | 2 |
| `web/src/markdown/render.ts` | 8 |
| `web/src/markdown/stream.ts` | 0 |
| `web/src/markdown/worker.ts` | 0 |
| `web/src/preview-runtime/boot.ts` | 16 |
| `web/src/state/artifact-panel.ts` | 0 |
| `web/src/styles/artifact-panel.css` | 0 |
| `web/src/ui/ArtifactPanel.tsx` | 36 |
| `web/src/ui/ArtifactsRoom.tsx` | 64 |
| `web/src/ui/ResponseSelection.tsx` | 9 |
| `web/src/ui/image-viewer.ts` | 0 |

### Windows and native shell (102)

| File | Estimate |
| --- | ---: |
| `desktop/app-icon.ts` | 2 |
| `desktop/browser-view.ts` | 14 |
| `desktop/folder-picker.ts` | 1 |
| `desktop/launcher/agentic-desktop-start` | 9 |
| `desktop/main.ts` | 16 |
| `desktop/preload.ts` | 0 |
| `desktop/processes.ts` | 0 |
| `desktop/sandbox.ts` | 0 |
| `desktop/server-entry.ts` | 1 |
| `desktop/shell/busy.html` | 24 |
| `desktop/shell/error.html` | 17 |
| `desktop/shell/shell.css` | 0 |
| `desktop/shell/shell.js` | 1 |
| `desktop/shell/starting.html` | 10 |
| `desktop/state.ts` | 1 |
| `desktop/status-area.ts` | 0 |
| `web/src/lib/desktop.ts` | 0 |
| `web/src/state/windows.ts` | 1 |
| `web/src/ui/WindowControls.tsx` | 5 |
