import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SteelVision | 热轧钢带划痕检测与质量追溯",
  description: "面向热轧钢表面缺陷检测、人工复核与质量追溯的工业质量管理平台。",
  openGraph: {
    title: "SteelVision | 热轧钢带划痕检测与质量追溯",
    description: "以生产批次、钢卷、检测、复核和质量追溯为主线的工业质量管理系统。",
    images: ["/steelvision-og-v3.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "SteelVision | 热轧钢带划痕检测与质量追溯",
    description: "面向热轧钢表面缺陷检测、人工复核与质量追溯。",
    images: ["/steelvision-og-v3.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
