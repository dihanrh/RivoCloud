import Link from 'next/link';
import { Plus } from 'lucide-react';
import { OnboardingShell } from '@/components/orgs/onboarding-shell';
import { OrgSwitcher } from '@/components/orgs/org-switcher';

export default function OrgsPage() {
  return (
    <OnboardingShell
      title="Choose an account"
      description="Select the account you want to work in. You can switch any time from the top bar."
      footer={
        <Link href="/orgs/new" className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
          <Plus className="h-4 w-4" aria-hidden />
          Create an account
        </Link>
      }
    >
      <OrgSwitcher />
    </OnboardingShell>
  );
}
