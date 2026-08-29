import Link from 'next/link';

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight">RivoCloud</h1>
      <p className="text-muted-foreground max-w-xl">
        One CDN, one object store, one dashboard — no juggling separate vendors for your edge caching and file storage.
      </p>
      <div className="flex gap-4">
        <Link href="/register" className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          Get started
        </Link>
        <Link href="/login" className="rounded-md border border-border px-4 py-2">
          Log in
        </Link>
      </div>
    </main>
  );
}
