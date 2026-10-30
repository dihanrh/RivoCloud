import { BrandLogo } from '@/components/brand/brand';
import { CreateOrgForm } from '@/components/orgs/create-org-form';

export default function NewOrgPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md rounded-[var(--radius)] border border-border bg-background p-6 sm:p-8">
        <div className="mb-6 flex justify-center">
          <BrandLogo width={150} />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">Your websites, buckets and team belong to an account.</p>
        <div className="mt-5">
          <CreateOrgForm />
        </div>
      </div>
    </main>
  );
}
