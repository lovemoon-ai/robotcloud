import { Suspense } from "react";
import InferenceClient from "./InferenceClient";

export default function InferencePage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <InferenceClient />
    </Suspense>
  );
}
