"use client";

import { useState } from "react";

type Detection = {
  class_id: number;
  class_name: string;
  confidence: number;
  bbox: number[];
};

type DetectionResult = {
  count: number;
  detections: Detection[];
  annotated_image: string;
};

export default function DetectionPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [threshold, setThreshold] = useState(0.25);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] =
    useState<DetectionResult | null>(null);

  async function detect() {
    if (!file || busy) return;

    setBusy(true);
    setError("");
    setResult(null);

    const form = new FormData();
    form.append("file", file);
    form.append("threshold", String(threshold));
    form.append("source", "manual");

    try {
      // 本机联调用地址。
      const response = await fetch(
        "http://127.0.0.1:8000/api/v1/inferences",
        {
          method: "POST",
          body: form,
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : `检测失败：HTTP ${response.status}`,
        );
      }

      setResult(data as DetectionResult);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "检测失败",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>钢板表面缺陷检测</h2>
      <p>上传 JPG 或 PNG 图片，最大 10 MB。</p>

      <input
        type="file"
        accept=".jpg,.jpeg,.png"
        disabled={busy}
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
          setResult(null);
          setError("");
        }}
      />

      <div style={{ margin: "16px 0" }}>
        <label>
          置信度阈值：{threshold.toFixed(2)}
          <input
            type="range"
            min="0.1"
            max="0.95"
            step="0.05"
            value={threshold}
            disabled={busy}
            onChange={(event) => {
              setThreshold(Number(event.target.value));
              setResult(null);
            }}
          />
        </label>
      </div>

      <button
        className="primary"
        disabled={!file || busy}
        onClick={detect}
      >
        {busy ? "正在检测…" : "开始检测"}
      </button>

      {error && <p role="alert">{error}</p>}

      {result && (
        <div style={{ marginTop: 20 }}>
          <p>检测到 {result.count} 个缺陷目标。</p>

          <img
            src={result.annotated_image}
            alt="模型检测结果"
            style={{
              display: "block",
              maxWidth: "100%",
              maxHeight: 600,
              objectFit: "contain",
            }}
          />

          {result.detections.map((item, index) => (
            <p key={index}>
              {index + 1}. {item.class_name}
              {" · "}
              置信度：
              {(item.confidence * 100).toFixed(1)}%
            </p>
          ))}

          {result.count === 0 && (
            <p>当前阈值下未检测到缺陷目标。</p>
          )}

          <p>这是单张图片试检结果，尚未保存到钢卷质量档案。</p>
        </div>
      )}
    </section>
  );
}