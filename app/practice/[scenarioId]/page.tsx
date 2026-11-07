import { PracticeSessionPage } from '../../../src/client/pages/PracticeSessionPage.tsx';

type Search = Record<string, string | string[] | undefined>;

export default async function Page({ params, searchParams }: { params: Promise<{ scenarioId: string }>; searchParams: Promise<Search> }) {
  const { scenarioId } = await params;
  const sp = await searchParams;
  // A new drill/parent query starts a fresh practice screen (same as the pre-Next router).
  const key = `${scenarioId}?drill=${String(sp.drill ?? '')}&parent=${String(sp.parent ?? '')}`;
  return <PracticeSessionPage key={key} scenarioId={scenarioId} />;
}
