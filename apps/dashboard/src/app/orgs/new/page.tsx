import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { OnboardingShell } from '@/components/orgs/onboarding-shell';
import { CreateOrgForm } from '@/components/orgs/create-org-form';

export default function NewOrgPage() {
  return (
    <OnboardingShell
      title="Create an account"
      description="Your websites, buckets and team belong to an account."
      footer={
        <Link href="/orgs" className="inline-flex items-center gap-1.5 font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to your accounts
        </Link>
      }
    >
      <CreateOrgForm />
    </OnboardingShell>
  );
}
