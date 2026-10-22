import assert from "node:assert/strict";
import test from "node:test";
import { selectImages, runBatch, runContinuous, resultsCsv, requestDetection, readServiceInfo } from "../app/detection.ts";

test("folder selection filters non-images, retains relative paths and reports invalid sizes", () => {
  const files = [
    { name: "b.PNG", size: 10, webkitRelativePath: "root/b.PNG" },
    { name: "a.jpg", size: 0, webkitRelativePath: "root/sub/a.jpg" },
    { name: "big.jpg", size: 11 * 1024 * 1024 },
    { name: "notes.txt", size: 10 },
  ];
  const { items, skipped } = selectImages(files);
  assert.equal(skipped, 1);
  assert.equal(items.length, 3);
  assert.ok(items.some(item => item.name === "root/sub/a.jpg" && item.error));
  assert.ok(items.some(item => item.name === "big.jpg" && item.error));
  assert.ok(items.some(item => item.name === "root/b.PNG" && !item.error));
});

test("batch is sequential and continues after a bad image", async () => {
  let active = 0;
  let maximum = 0;
  const updates = [];
  await runBatch([1, 2, 3], async value => {
    maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    if (value === 2) throw new Error("invalid image");
    return value * 10;
  }, (index, update) => updates.push([index, update]), new AbortController().signal);
  assert.equal(maximum, 1);
  assert.deepEqual(updates.filter(([, update]) => update.status === "success").map(([i, u]) => [i, u.result]), [[0, 10], [2, 30]]);
  assert.equal(updates.find(([i, u]) => i === 1 && u.status === "error")[1].error, "invalid image");
});

test("stopping a batch finishes the current image but starts no further images", async () => {
  const controller = new AbortController();
  const processed = [];
  const updates = [];
  await runBatch([1, 2, 3], async value => {
    processed.push(value);
    controller.abort();
    return value;
  }, (_, update) => updates.push(update), controller.signal);
  assert.deepEqual(processed, [1]);
  assert.equal(updates.at(-1).status, "success");
});

test("camera loop waits for each frame and suppresses results after stop", async () => {
  const controller = new AbortController();
  let captures = 0;
  let active = 0;
  let maximum = 0;
  const results = [];
  await runContinuous(async () => {
    maximum = Math.max(maximum, ++active);
    captures++;
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    if (captures === 3) controller.abort();
    return captures;
  }, value => results.push(value), controller.signal, 0);
  assert.equal(maximum, 1);
  assert.equal(captures, 3);
  assert.deepEqual(results, [1, 2]);
});

test("camera errors stop the loop rather than flooding an unavailable backend", async () => {
  let attempts = 0;
  await assert.rejects(runContinuous(async () => {
    attempts++;
    throw new Error("offline");
  }, () => {}, new AbortController().signal, 0), /offline/);
  assert.equal(attempts, 1);
});

test("CSV preserves details and escapes quotes, commas and formula-like filenames", () => {
  const csv = resultsCsv([{ name: '=bad,"x".jpg', status: "success", result: { count: 1, detections: [{ class_name: "scratch", confidence: 0.9, bbox: [1, 2, 3, 4] }] } }]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"\'=bad,""x"".jpg"'));
  assert.ok(csv.includes("scratch"));
  assert.ok(csv.includes("0.9"));
});

test("inference sends the selected source and threshold and surfaces backend errors", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.body.get("source"), "camera");
      assert.equal(options.body.get("threshold"), "0.25");
      assert.equal(options.body.get("file").name, "frame.jpg");
      return new Response(JSON.stringify({ detail: "图片无法解码" }), { status: 400 });
    };
    await assert.rejects(requestDetection(new File(["bad"], "frame.jpg", { type: "image/jpeg" }), 0.25, "camera"), /图片无法解码/);
  } finally { globalThis.fetch = original; }
});

test("status rejects unrelated or malformed ready responses", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ mode: "ready" }));
    await assert.rejects(readServiceInfo(), /状态/);
    globalThis.fetch = async () => new Response(JSON.stringify({ service: "steelvision-backend", mode: "ready" }));
    assert.equal((await readServiceInfo()).mode, "ready");
    globalThis.fetch = async () => new Response("offline", { status: 503 });
    await assert.rejects(readServiceInfo(), /503/);
  } finally { globalThis.fetch = original; }
});

test("archive requests retain coil context and send cookies; preview frames never archive by default", async () => {
  const original = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (_url, options) => {
      requests.push({ credentials: options.credentials, coil: options.body.get("coil_id"), archive: options.body.get("archive") });
      return new Response(JSON.stringify({ model: "best.pt", count: 0, detections: [], annotated_image: "data:image/jpeg;base64,YQ==", image_width: 1, image_height: 1, record_id: "record-1" }));
    };
    const frame = new File(["frame"], "frame.jpg");
    await requestDetection(frame, .25, "camera");
    const saved = await requestDetection(frame, .25, "camera", undefined, { coilId: "coil-7", archive: true });
    await requestDetection(frame, .25, "manual");
    assert.deepEqual(requests, [
      { credentials: "include", coil: null, archive: "false" },
      { credentials: "include", coil: "coil-7", archive: "true" },
      { credentials: "include", coil: null, archive: "true" },
    ]);
    assert.equal(saved.record_id, "record-1");
  } finally { globalThis.fetch = original; }
});
