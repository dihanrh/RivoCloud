import { OrgSwitcher } from '@/components/orgs/org-switcher';

export default function OrgsPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="text-xl font-semibold">Choose an organization</h1>
      <OrgSwitcher />
    </main>
  );
}
