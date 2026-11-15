---
name: excel
description: Lag, analyser eller oppdater Excel-regneark med riktige datatyper, formler og forståelige resultater. Bruk for xlsx og regnearkberegninger.
args: "[regneark, data eller beregning]"
---
# Excel workbooks

Task: {{args}}

If no task is given above, use the conversation. Follow the requested scope, supplied data and template. Keep source values, assumptions and calculated results distinguishable. Do not invent missing inputs or treat missing values as zero.

## Choose the available workflow
- In Chat, use `create_document` for a new `.xlsx`. It accepts structured data, not scripts or paths. Use only fields in its current tool schema.
- Chat sheets have `name`, optional string `headers`, and `rows` of cells. Cells are strings, finite numbers, booleans, null, or explicit formula objects. Strings beginning with `=` remain text. Use numeric cells for quantities and text for identifiers that must retain leading zeros.
- A formula is `{"formula":"SUM(B2:B3)","result":200}`. Use Excel function names and comma separators. `result` is an optional numeric cached value: supply it only after independently calculating the same expression from the same inputs. ExcelJS does not evaluate formulas. Recalculation on opening is requested but has not been verified merely because export succeeds.
- Current Chat bounds are 10 sheets, 5,000 data rows per sheet, 100 columns per row, 50,000 data cells, about 250,000 characters of serialized input and 10 MB per output. Use short, unique sheet names, at most 31 characters. Do not silently truncate data to fit.
- Chat does not expose custom cell formats, typed date objects, charts, pivots, validation, images, templates or Office editing through this generator. Use clearly labeled ISO date text when simple date display suffices; offer Code when real date arithmetic or richer workbook features matter.
- If `run_python` is available, use its standard library for data preparation and independent totals. Its `agentic_files.create_document(name, sheets=[...])` helper submits the same structured request; it adds no Excel features. It cannot install libraries, access project files or fetch data. Check its returned errors before claiming success.
- In Code, inspect the actual files and available tools/dependencies first. Reuse a suitable installed library such as ExcelJS, openpyxl or XlsxWriter when available. Pick a library with the needed read/edit or creation support; do not assume every writer can preserve an existing workbook. Preserve unaffected sheets, formulas, styles and objects, and save a new copy unless replacement was requested.
- Skill selection does not enable missing tools. Respect current document/Python settings; explain a missing capability and suggest a supported workflow.

## Build useful calculations
- Use the simplest workbook that answers the request. Put the main result where readers can find it, with labeled supporting inputs and units. Add tabs only for a distinct need.
- Preserve source grain, reporting periods and identifiers. Calculate rates from the appropriate numerator and denominator; do not average percentages without the needed weights or double-count subtotal rows.
- Keep calculations in formulas when users need editable results. Anchor shared references deliberately and check copied formulas at the first, middle and last affected rows or periods.
- Distinguish blanks, zero, unavailable results and errors. Guard expected exceptions such as a zero denominator; avoid blanket `IFERROR(...,0)` that hides broken inputs.
- Keep untrusted imported text as text. Do not introduce macros, external workbook links or functions that fetch data.

## Check and deliver
- Reconcile key totals with an independent calculation. Check ranges, units, missing/duplicate keys and any relevant boundary cases.
- In Chat, inspect the submitted data and successful tool response. Do not claim workbook rendering, formula-engine recalculation or Excel compatibility checks that were not performed.
- In Code, reopen the saved file and inspect the affected values/formulas. If an appropriate calculation engine is available, recalculate a disposable copy and verify representative input changes; a cached result is not proof. Render affected sheets when layout or charts matter and a renderer is available.
- Return the actual output link or path. State any material unsupported feature or unverified calculation/rendering briefly, without labeling an unperformed check as passed.

Reference: [ExcelJS formulas and cached results](https://github.com/exceljs/exceljs#formula-value).
