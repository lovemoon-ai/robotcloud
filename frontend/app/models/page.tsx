import { Suspense } from "react";
import ModelsClient from "./ModelsClient";

export default function ModelsPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <ModelsClient />
    </Suspense>
  );
}
