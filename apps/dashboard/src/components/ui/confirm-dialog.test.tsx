import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ApiError } from '@/lib/http';
import { ConfirmDialog } from './confirm-dialog';
import { ToastProvider } from './toast';

function Harness({ onConfirm, requireText }: { onConfirm: () => Promise<unknown>; requireText?: string }) {
  const [open, setOpen] = useState(true);
  return (
    <ToastProvider>
      <span data-testid="state">{open ? 'open' : 'closed'}</span>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        tone="destructive"
        title="Delete bucket"
        description="This permanently deletes the bucket."
        confirmLabel="Delete bucket"
        requireText={requireText}
        successToast="Bucket deleted"
        onConfirm={onConfirm}
      />
    </ToastProvider>
  );
}

describe('ConfirmDialog', () => {
  it('keeps the confirm button disabled until the required text is typed', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<Harness onConfirm={onConfirm} requireText="media-assets" />);
    const confirm = screen.getByRole('button', { name: 'Delete bucket' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/to confirm/), 'media-asset');
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/to confirm/), 's');
    expect(confirm).toBeEnabled();
  });

  it('shows a pending state, then closes and toasts on success', async () => {
    let resolve!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    render(<Harness onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete bucket' }));
    const confirm = screen.getByRole('button', { name: 'Delete bucket' });
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    resolve();
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('closed'));
    expect(await screen.findByText('Bucket deleted')).toBeInTheDocument();
  });

  it('shows the server error inline and stays open on failure', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new ApiError(409, { message: 'Bucket is not empty.' }));
    render(<Harness onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete bucket' }));
    expect(await screen.findByText('Bucket is not empty.')).toBeInTheDocument();
    expect(screen.getByTestId('state')).toHaveTextContent('open');
    expect(screen.getByRole('button', { name: 'Delete bucket' })).toBeEnabled();
  });
});
