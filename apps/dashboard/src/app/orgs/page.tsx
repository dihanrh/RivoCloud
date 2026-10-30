import Link from 'next/link';
import { BrandLogo } from '@/components/brand/brand';
import { OrgSwitcher } from '@/components/orgs/org-switcher';

export default function OrgsPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md rounded-[var(--radius)] border border-border bg-background p-6 sm:p-8">
        <div className="mb-6 flex justify-center">
          <BrandLogo width={150} />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Choose an account</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">Select the account you want to work in.</p>
        <div className="mt-5">
          <OrgSwitcher />
        </div>
        <p className="mt-5 border-t border-border pt-4 text-[13px]">
          <Link href="/orgs/new" className="text-primary hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
