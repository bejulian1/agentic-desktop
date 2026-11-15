---
name: powerpoint
description: Lag eller oppdater PowerPoint-presentasjoner med tydelige lysbilder, korrekt innhold og lesbar utforming. Bruk for pptx og presentasjonsutkast.
args: "[presentasjon, målgruppe og ønsket innhold]"
---
# PowerPoint presentations

Task: {{args}}

If no task is given above, use the conversation. Use the requested audience, purpose, slide count and reference material. A requested slide count includes the cover unless the user says otherwise. Follow a supplied template when the task asks for its design.

## Choose the available workflow
- In Chat, use `create_document` with a `.pptx` filename, optional `title`, and `slides`. Each slide has a required `title` and optional `body`, string `bullets`, and `notes`.
- Chat creates a new, editable, text-only deck in one fixed widescreen layout. It accepts no fields for images, charts, tables, diagrams, custom positions, themes, animations or importing an existing deck. Use Code for those requirements and for template-sensitive edits.
- Chat supports at most 30 slides, within about 250,000 characters of serialized input and 10 MB per output. Technical text limits are not layout targets. Keep on-slide text brief; automatic shrinking does not prove readability.
- If `run_python` is available, use it for standard-library calculations or content preparation. `agentic_files.create_document(name, title=..., slides=[...])` submits the same text-only builder. It does not provide presentation libraries, rendering, network or project access.
- In Code, inspect installed libraries and the supplied deck first. Use a suitable available authoring library such as PptxGenJS or python-pptx. Confirm import/edit support before choosing a tool for an existing deck; creation support alone does not establish fidelity. Preserve unaffected slides, notes, masters and assets, and save a copy unless overwrite was requested.
- Respect current document/Python settings. Explain an unavailable capability and suggest a supported workflow instead of promising it.

## Make each slide useful
- Outline the story before generating. Give each slide one subject, comparison or conclusion. Use a descriptive title, or a takeaway only when the evidence supports it.
- Favor short body text or a few focused bullets over paragraphs copied from a report. Put supporting detail in notes. Do not fill a required slide count by repeating the same point.
- Preserve factual scope, dates, units and comparisons. Independently check any computed values. Identify assumptions rather than presenting them as sourced facts.
- Keep sources near the claim or in that slide's notes, depending on audience needs. Do not invent citations. Keep internal authoring commentary out of slides and notes.
- In Code, keep requested charts, tables and diagrams editable when the selected tool supports them. Use meaningful graphics, readable contrast and a consistent type scale. Shorten or split crowded content before shrinking type.

## Check and deliver
- Verify slide count, order, coverage, notes and numeric consistency. Read titles with their bodies to catch unsupported takeaways or repetition.
- In Chat, confirm a successful output file and describe it accurately as a text-only deck when richer visuals were requested. No presentation renderer is exposed by these tools.
- In Code, reopen the saved deck to inspect content. When a renderer is available, render every new or affected slide and inspect text fit, overlap, clipping, chart labels and image proportions at normal viewing size. Check that exported content and requested native objects survived.
- Return the actual final file. Mention material unsupported features or unavailable visual checks briefly. Claim testing in PowerPoint only after opening and checking it there.

Reference: [PptxGenJS text options](https://gitbrent.github.io/PptxGenJS/docs/api-text.html).
