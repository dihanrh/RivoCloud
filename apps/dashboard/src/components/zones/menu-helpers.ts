import type { useToast } from '@/components/ui/toast';

/**
 * Copy text from a menu item (where no CopyButton morph is visible), then
 * confirm with a toast. Returns whether the copy worked.
 */
export async function copyToClipboard(
  text: string,
  toast: ReturnType<typeof useToast>,
  messages: { success: string; description?: string },
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(messages.success, messages.description);
    return true;
  } catch {
    toast.error('Could not copy to the clipboard', 'Your browser blocked clipboard access. Copy the text manually.');
    return false;
  }
}

