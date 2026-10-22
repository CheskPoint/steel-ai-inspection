import test from "node:test";
import assert from "node:assert/strict";
import { summarizeRecords, searchRecords, validBox } from "../app/platform-utils.ts";

test("analytics uses archived records and reviewed boxes, retaining pending counts", () => {
  const records = [
    { created_at: "2026-10-16T01:00:00Z", review_status: "pending", detections: [{ class_name: "scratches" }], reviewed_detections: null },
    { created_at: "2026-10-16T02:00:00Z", review_status: "false_positive", detections: [{ class_name: "scratches" }], reviewed_detections: [] },
    { created_at: "2026-10-16T03:00:00Z", review_status: "corrected", detections: [], reviewed_detections: [{ class_name: "patches" }] },
  ];
  const summary = summarizeRecords(records);
  assert.equal(summary.total, 3);
  assert.equal(summary.pending, 1);
  assert.equal(summary.reviewed, 2);
  assert.equal(summary.confirmedTargets, 1);
  assert.deepEqual(summary.classes, [{ name: "patches", count: 1 }]);
});

test("record filter combines coil, status, date, class and text without hiding unassigned entries", () => {
  const records = [
    { id: "1", filename: "a.png", coil_id: null, review_status: "pending", created_at: "2026-10-16T12:00:00Z", detections: [{ class_name: "scratches" }] },
    { id: "2", filename: "b.png", coil_id: "c2", review_status: "confirmed", created_at: "2026-10-15T12:00:00Z", detections: [] },
  ];
  assert.deepEqual(searchRecords(records, { coil: "unassigned", status: "pending", from: "2026-10-16", to: "2026-10-16", category: "scratches", query: "a" }).map(x => x.id), ["1"]);
  assert.equal(searchRecords(records, { coil: "c2", query: "a" }).length, 0);
});

test("review boxes reject zero area, off-image coordinates and non-finite values", () => {
  assert.equal(validBox([1, 2, 50, 60], 100, 100), true);
  for (const box of [[2,2,2,10],[-1,0,10,10],[0,0,101,10],[0,0,NaN,10]]) assert.equal(validBox(box, 100, 100), false);
});


test("employee cannot open account management, settings or operation logs in either layout", async () => {
  const { canAccessView } = await import("../app/roles.ts");
  for (const view of ["users", "settings", "logs"]) {
    assert.equal(canAccessView("inspector", view), false);
    assert.equal(canAccessView("admin", view), true);
  }
  for (const view of ["detect", "batches", "coils", "review", "trace", "analysis", "reports"]) assert.equal(canAccessView("inspector", view), true);
});


test("date folders use Beijing dates across midnight and retain filtered results", async () => {
  const { groupInspectionFolders } = await import("../app/platform-utils.ts");
  const records = [
    {id:"a", filename:"one.jpg", created_at:"2026-10-20T15:59:00Z", review_status:"pending", detections:[]},
    {id:"b", filename:"two.jpg", created_at:"2026-10-20T16:01:00Z", review_status:"auto_confirmed", detections:[]},
    {id:"c", filename:"three.jpg", created_at:"2026-10-21T07:00:00Z", review_status:"confirmed", detections:[]},
  ];
  const folders = groupInspectionFolders(records);
  assert.deepEqual(folders.map(f=>[f.date,f.records.map(r=>r.id)]), [["2026-10-21",["c","b"]],["2026-10-20",["a"]]]);
  assert.deepEqual(searchRecords(records,{from:"2026-10-21",to:"2026-10-21"}).map(r=>r.id),["b","c"]);
  assert.deepEqual(searchRecords(records,{status:"completed"}).map(r=>r.id),["b","c"]);
  assert.deepEqual(groupInspectionFolders(searchRecords(records,{query:"two"})).map(f=>f.records.map(r=>r.id)),[["b"]]);
});
