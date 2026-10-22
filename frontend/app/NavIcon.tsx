import type { View } from "./platform-types";

const paths: Record<View, string> = {
  overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  detect: "M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5 M7 12h10 M12 7v10",
  batches: "M3 7l9-4 9 4v11l-9 4-9-4z M3 7l9 4 9-4 M12 11v11",
  coils: "M19 12a7 9 0 1 1-14 0 7 9 0 1 1 14 0 M15 12a3 5 0 1 1-6 0 3 5 0 1 1 6 0",
  review: "M8 3h12v18H4V7 M8 3v5H4 M8 14l3 3 6-7",
  trace: "M16 10a6 6 0 1 1-12 0 6 6 0 1 1 12 0 M15 15l6 6",
  analysis: "M4 3v18h17 M8 17v-5 M13 17V7 M18 17V4",
  reports: "M5 3h10l4 4v14H5z M14 3v5h5 M9 12h6 M9 16h6",
  knowledge: "M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1z M12 5v15",
  devices: "M3 5h18v12H3z M8 21h8 M12 17v4 M8 11h8",
  models: "M8 8h8v8H8z M9 3v5 M15 3v5 M9 16v5 M15 16v5 M3 9h5 M3 15h5 M16 9h5 M16 15h5",
  alerts: "M12 3L2 21h20z M12 9v5 M12 17v1",
  users: "M15 7a3 3 0 1 1-6 0 3 3 0 1 1 6 0 M5 21v-3a7 7 0 0 1 14 0v3 M19 4a3 3 0 0 1 0 6 M22 20v-3a5 5 0 0 0-3-4",
  logs: "M5 4h14v17H5z M9 2v4 M15 2v4 M9 10h6 M9 14h6 M9 18h4",
  settings: "M12 3v3 M12 18v3 M3 12h3 M18 12h3 M6 6l2 2 M16 16l2 2 M6 18l2-2 M16 8l2-2 M17 12a5 5 0 1 1-10 0 5 5 0 1 1 10 0",
};
export default function NavIcon({ view }: { view: View }) {
  return <svg className="sv-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[view]}/></svg>;
}
