import { ProcessingPage } from "@/components/pages/processing-page";

export default async function Page({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return <ProcessingPage jobId={jobId} />;
}
