import { RepProfilePage } from '../../../../src/client/pages/manager-team.tsx';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RepProfilePage id={id} />;
}
