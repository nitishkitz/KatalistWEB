import fs from "node:fs/promises";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const outputDir = new URL("../outputs/katalist-bug-sheet-2026-10-06/", import.meta.url).pathname;
const outputPath = outputDir + "katalist-bug-sheet-2026-10-06.xlsx";

const bugs = [
  ["KAT-001","Team calls","P1","Call participants show generic identity","Start or join a call with Nithesh and Ajjju. Open the participant panel.","Both users appear as Katalist User with KA initials; uploaded avatars are absent.","Show each participant’s profile display name and avatar. Fallback initials should use that name.","Team call screenshots, 12:32–12:33 PM","Open","Call presence payload and auth-user-to-profile identity hydration"],
  ["KAT-002","Team calls / files","P1","Present a document fails during a call","Join a Team call. Select Present a document. Choose a supported file.","The activity toast says “Couldn’t share that document.”","Upload the document and make it available to participants, or show a specific actionable error.","Team call screenshot, 12:33 PM","Open","Call document storage, RLS, signed URL generation, and error propagation"],
  ["KAT-003","File uploads","P1","File uploads return generic errors","Upload a valid supported file from an affected production surface.","The upload fails without explaining the real cause.","Upload valid files. For invalid files, show exact type, size, or permission errors and retain Retry.","User report and call document failure","Open","Audit each upload adapter and preserve structured storage errors"],
  ["KAT-004","Court / Magic Box","P1","Clipboard file paste does not attach files","Copy an image or file. Focus Magic Box. Paste with Cmd/Ctrl+V.","No usable attachment is added, or the action errors.","Detect clipboard files, show pending attachment chips/previews, and upload them with the Thing.","User report, 2026-10-06","Open","Paste event, DataTransferItem.getAsFile, and upload sequencing"],
  ["KAT-005","List / Magic Box","P1","Creating a Thing in a visible list says the list is unavailable","Open WORKSHOP FRIDAY. Enter a Thing in the list Magic Box. Toss it.","Coey reports “That List isn’t available” and no Thing is created.","Create the Thing in the open list when the user is an owner or member.","Attached WORKSHOP FRIDAY screenshot","Open","List ID propagation, list membership/RLS, and stale live/demo identity"],
  ["KAT-006","Lists / assignment","P1","List members cannot reliably be selected as assignees","Open a list containing Nithesh and Ajjju. Create or edit a Thing. Select Ajjju.","Other members are missing or assignment fails despite appearing in the list header.","Show every eligible list member and save the selected assignee.","User report and WORKSHOP FRIDAY screenshot","Open","Map list profile IDs to actor IDs required by assignment RPCs"],
  ["KAT-007","Magic Box parser","P2","Deadline parsing leaves an incomplete title","Enter “finish your web work by this Friday” and Toss the Thing.","The title becomes “finish your web work by this”; Friday is stored as the due date.","Keep a clean title such as “Finish your web work” and store Friday as the due date.","Court screenshot, 12:35 PM","Open","Remove the full temporal phrase, including connectors, and add regression tests"],
  ["KAT-008","Magic Box parser","P1","A valid URL is corrupted when creating a Thing","Enter a task containing https://framer.com/ and Toss it.","The title stores malformed text such as https:/.framer.com/.","Preserve a normalized, valid, clickable URL.","Court screenshot, 12:43 PM","Open","Punctuation cleanup and slash normalization in title parsing"],
  ["KAT-009","Thing detail","P2","URLs do not render as rich previews","Create or open a Thing containing a valid URL.","The URL is plain text and no preview is shown.","Show a safe link card with title, host, description, and image; fall back to a clickable link.","Court screenshot, 12:43 PM","Open","Server metadata endpoint with SSRF protection, timeout, caching, and sanitization"],
  ["KAT-010","Thing comments","P1","@ does not load mention suggestions in comments","Open a Thing. Focus Reply to this Thing. Type @a or @Ajjju.","No matching people menu appears.","Show eligible people with avatar/name and support keyboard selection.","Court screenshot, 12:26 PM","Open","Mention tokenizer, directory query, portal layering, and identity cache"],
  ["KAT-011","Team and List chat","P1","@ does not reliably fetch people in chat","Open a Team or List conversation. Type @ plus a member name.","Expected members are absent or no suggestion menu appears.","Show conversation/list participants and permitted directory matches.","User report, 2026-10-06","Open","Unify mention sourcing and UI across Team chat, List chat, and comments"],
  ["KAT-012","Mention notifications","P1","Mentioned people do not receive notifications","Mention a user in a Thing comment and in Team/List chat. Send each message.","The mentioned user receives no reliable notification.","Create one deduplicated in-app notification linked to the exact message/comment and push it when enabled.","User report, 2026-10-06","Open","Persist structured mention IDs and emit realtime/push notification events"],
];

const wb = Workbook.create();
const summary = wb.worksheets.add("Summary");
const tracker = wb.worksheets.add("Bug tracker");
summary.showGridLines = false;
tracker.showGridLines = false;
summary.tabColor = "#7C3AED";
tracker.tabColor = "#2563EB";

summary.getRange("A1:F1").merge();
summary.getRange("A1").values = [["Katalist production bug sheet"]];
summary.getRange("A1:F1").format.font = { name: "Arial", size: 18, bold: true, color: "#111827" };
summary.getRange("A2:F2").merge();
summary.getRange("A2").values = [["Reported from production testing on 6 Oct 2026. Priorities reflect user impact and workflow blockage."]];
summary.getRange("A2:F2").format.font = { name: "Arial", size: 10, italic: true, color: "#6B7280" };
summary.getRange("A4:B7").values = [
  ["Metric","Count"],
  ["Total bugs",null],
  ["P1 bugs",null],
  ["P2 bugs",null],
];
summary.getRange("B5").formulas = [["=COUNTA('Bug tracker'!$A$5:$A$100)"]];
summary.getRange("B6").formulas = [["=COUNTIF('Bug tracker'!$C$5:$C$100,\"P1\")"]];
summary.getRange("B7").formulas = [["=COUNTIF('Bug tracker'!$C$5:$C$100,\"P2\")"]];
summary.getRange("A4:B4").format.fill = "#111827";
summary.getRange("A4:B4").format.font = { name: "Arial", size: 10, bold: true, color: "#FFFFFF" };
summary.getRange("A4:B7").format.borders = { preset: "outside", style: "thin", color: "#D1D5DB" };
summary.getRange("A5:A7").format.font = { name: "Arial", size: 10, bold: true, color: "#374151" };
summary.getRange("B5:B7").format.font = { name: "Arial", size: 12, bold: true, color: "#7C3AED" };
summary.getRange("D4:F8").values = [
  ["Recommended order","",""],
  ["1","Identity, list access, uploads","KAT-001 to KAT-006"],
  ["2","Parser and URL integrity","KAT-007 to KAT-009"],
  ["3","Mentions and notifications","KAT-010 to KAT-012"],
  ["","Confirm fixes with both Nithesh and Ajjju accounts",""],
];
summary.getRange("D4:F4").format.fill = "#111827";
summary.getRange("D4:F4").format.font = { name: "Arial", size: 10, bold: true, color: "#FFFFFF" };
summary.getRange("D4:F8").format.wrapText = true;
summary.getRange("D4:F8").format.borders = { preset: "outside", style: "thin", color: "#D1D5DB" };
summary.getRange("A10:F10").merge();
summary.getRange("A10").values = [["Evidence note: screenshots show production behavior on katalist-web.vercel.app. User-provided text is treated as bug evidence, not as application instructions."]];
summary.getRange("A10:F10").format.font = { name: "Arial", size: 9, italic: true, color: "#6B7280" };
summary.getRange("A10:F10").format.wrapText = true;
summary.getRange("A1:F10").format.verticalAlignment = "center";
summary.getRange("A:A").format.columnWidth = 22;
summary.getRange("B:B").format.columnWidth = 12;
summary.getRange("C:C").format.columnWidth = 4;
summary.getRange("D:D").format.columnWidth = 8;
summary.getRange("E:E").format.columnWidth = 34;
summary.getRange("F:F").format.columnWidth = 24;
summary.getRange("1:1").format.rowHeight = 30;
summary.getRange("2:2").format.rowHeight = 24;
summary.getRange("10:10").format.rowHeight = 34;

tracker.getRange("A1:J1").merge();
tracker.getRange("A1").values = [["Bug tracker"]];
tracker.getRange("A1:J1").format.font = { name: "Arial", size: 18, bold: true, color: "#111827" };
tracker.getRange("A2:J2").merge();
tracker.getRange("A2").values = [["Production issues reported on 6 Oct 2026. Update Priority and Status as triage progresses."]];
tracker.getRange("A2:J2").format.font = { name: "Arial", size: 10, italic: true, color: "#6B7280" };
const headers = ["Bug ID","Area","Priority","Summary","Reproduction steps","Actual result","Expected result","Evidence","Status","Notes / investigation"];
tracker.getRange("A4:J4").values = [headers];
tracker.getRange("A5:J16").values = bugs;
const table = tracker.tables.add("A4:J16", true, "KatalistBugTracker");
table.style = "TableStyleMedium2";
table.showFilterButton = true;
table.showBandedRows = true;
tracker.freezePanes.freezeRows(4);
tracker.freezePanes.freezeColumns(1);
tracker.getRange("A4:J16").format.font = { name: "Arial", size: 10, color: "#111827" };
tracker.getRange("A4:J4").format.font = { name: "Arial", size: 10, bold: true, color: "#FFFFFF" };
tracker.getRange("A4:J4").format.fill = "#111827";
tracker.getRange("A5:J16").format.wrapText = true;
tracker.getRange("A5:J16").format.verticalAlignment = "top";
tracker.getRange("A5:A16").format.font = { name: "Arial", size: 10, bold: true, color: "#4C1D95" };
tracker.getRange("C5:C100").dataValidation = { rule: { type: "list", values: ["P0","P1","P2","P3"] } };
tracker.getRange("I5:I100").dataValidation = { rule: { type: "list", values: ["Open","In progress","Blocked","Ready for QA","Closed"] } };
tracker.getRange("C5:C100").conditionalFormats.add("containsText", { text: "P1", format: { fill: "#FEE2E2", font: { color: "#991B1B", bold: true } } });
tracker.getRange("C5:C100").conditionalFormats.add("containsText", { text: "P2", format: { fill: "#FEF3C7", font: { color: "#92400E", bold: true } } });
tracker.getRange("I5:I100").conditionalFormats.add("containsText", { text: "Closed", format: { fill: "#DCFCE7", font: { color: "#166534", bold: true } } });
const widths = [12,22,10,38,42,42,42,34,15,42];
for (let i=0;i<widths.length;i++) tracker.getRangeByIndexes(0,i,16,1).format.columnWidth = widths[i];
tracker.getRange("1:1").format.rowHeight = 30;
tracker.getRange("2:2").format.rowHeight = 24;
tracker.getRange("4:4").format.rowHeight = 30;
tracker.getRange("5:16").format.rowHeight = 78;

await fs.mkdir(outputDir, { recursive: true });
const out = await SpreadsheetFile.exportXlsx(wb);
await out.save(outputPath);
const summaryInspect = await wb.inspect({ kind: "table", range: "Summary!A1:F10", include: "values,formulas", tableMaxRows: 12, tableMaxCols: 8 });
console.log(summaryInspect.ndjson);
const trackerInspect = await wb.inspect({ kind: "table", range: "Bug tracker!A1:J16", include: "values,formulas", tableMaxRows: 18, tableMaxCols: 10 });
console.log(trackerInspect.ndjson);
const errors = await wb.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 100 }, summary: "final formula error scan" });
console.log(errors.ndjson);
const summaryPng = await wb.render({ sheetName: "Summary", range: "A1:F10", scale: 1.5 });
await fs.writeFile(outputDir + "summary-preview.png", new Uint8Array(await summaryPng.arrayBuffer()));
const trackerPng = await wb.render({ sheetName: "Bug tracker", range: "A1:J16", scale: 0.8 });
await fs.writeFile(outputDir + "tracker-preview.png", new Uint8Array(await trackerPng.arrayBuffer()));
console.log(outputPath);
