import { notFound } from 'next/navigation';
import { UiPreview } from '@/components/ui/ui-preview';

/** Dev-only gallery of every console primitive (404 in production builds). */
export default function UiPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <UiPreview />;
}
