import * as XLSX from "xlsx";
import { parseSchedule } from "./lib/parseSchedule.js";

// Rebuild a representative slice of the real sheet: header row + MDF jobs,
// then an FC header + FC jobs + an avg line to prove the block-stop logic.
const aoa = [
  ["DECOR FACTORY", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
  ["JOB","Project","L","U","M","I","N","B","O","X","Product/Hole Diam","Approval Date","Commited Completion Date","Actual Completion Date","Lead time from approval (Weeks)","MATERIALS","Vitap","CNC","EDGER","Moulder","PRIORITY"],
  ["21222-1","Rockingham Senior HS","","","","","","","","","DecorZen/Style","19/06/26","28/07/26","","6.4","183x Sheets","2","","","",""],
  ["22412-1","CoStar Parkline Place","","","","","","","","","DecorZen CoC","16/06/26","29/07/26","","7.0","56x Sheets","3","3","","",""],
  ["17630","Logan Hospital - Remakes","","","","","","","","","DecorStyle","28/07/26","31/07/26","","2","7x Sheets","","","","",""],
  ["17232b-3","Queen Elizabeth II Hospital - Level 4","","","","","","","","","DecorZen","25/06/26","3/08/26","","4.4","19x Sheets","3","2","","",""],
  ["","","","","","","","","","","","","","","","","","","","",""],
  ["","","","","","","","","","","","Avg Lead time","3.9","","","","","","","",""],
  ["JOB","In House Fibre Cement Projects","L","U","M","I","N","B","O","X","Product","Approval Date","Completion Date","Actual Completion Date","Lead time from approval (Weeks)","MATERIALS","Vitap","CNC","EDGER","Moulder","PRIORITY"],
  ["22407-1","Rouse Hill Town Centre","","","","","","","","","DecorLux","24/06/26","17/07/26","4/08/26","3.4","73x Sheets","3","2","","",""],
  ["18814-1","Medowie HS","","","","","","","","","DecorLux","9/07/26","13/08/26","","5.0","95x Sheets","3","","","",""],
  ["","","","","","","","","","","","Avg Lead Time","3.4","","","","","","","",""],
];

const ws = XLSX.utils.aoa_to_sheet(aoa);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Schedule");
const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

const { jobs, avgLead } = parseSchedule(buffer);
console.log("avgLead:", avgLead);
console.log("job count:", jobs.length);
console.log(JSON.stringify(jobs, null, 2));
