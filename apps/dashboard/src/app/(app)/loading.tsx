import { PageSkeleton } from '@/components/ui/skeleton';

/** Shown inside the shell while any (app) route segment loads. */
export default function AppLoading() {
  return <PageSkeleton />;
}
