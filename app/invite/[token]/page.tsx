import { InvitePage } from '../../../src/client/pages/auth.tsx';

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InvitePage token={token} />;
}
