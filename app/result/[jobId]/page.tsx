import { ResultPage } from "@/components/pages/result-page";

export default async function Page({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return <ResultPage jobId={jobId} />;
}
