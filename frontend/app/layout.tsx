import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CR7 智检 | 冷轧钢板表面缺陷检测与质量追溯",
  description: "面向冷轧钢板表面缺陷检测、人工复核与质量追溯的工业质量管理平台。",
  openGraph: {
    title: "CR7 智检 | 冷轧钢板表面缺陷检测与质量追溯",
    description: "以生产批次、钢板、检测、复核和质量追溯为主线的工业质量管理系统。",
  },
  twitter: {
    card: "summary",
    title: "CR7 智检 | 冷轧钢板表面缺陷检测与质量追溯",
    description: "面向冷轧钢板表面缺陷检测、人工复核与质量追溯。",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
