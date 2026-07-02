import { notFound } from "next/navigation";
import { SO101Client } from "./SO101Client";

const isDesktopBuild =
  process.env.ROBOTCLOUD_DESKTOP_BUILD === "1" ||
  process.env.NEXT_PUBLIC_ROBOTCLOUD_DESKTOP_BUILD === "1";

export default function SO101Page() {
  if (!isDesktopBuild) {
    notFound();
  }

  return <SO101Client />;
}
