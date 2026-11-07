import { ManagerSessionPage } from '../../../../src/client/pages/manager.tsx';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ManagerSessionPage id={id} />;
}
