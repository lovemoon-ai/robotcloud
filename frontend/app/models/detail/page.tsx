import { Suspense } from "react";
import ModelDetailClient from "./ModelDetailClient";

export default function ModelDetailPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <ModelDetailClient />
    </Suspense>
  );
}
