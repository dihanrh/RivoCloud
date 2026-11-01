import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/toast';
import { UploadButton } from './upload-button';

/** Minimal XHR double: reports two progress events, then finishes with `status`. */
function installFakeXhr(status: number) {
  const sent: { method: string; url: string; body: unknown }[] = [];
  class FakeXhr {
    status = 0;
    upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private method = '';
    private url = '';
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader() {}
    send(body: unknown) {
      sent.push({ method: this.method, url: this.url, body });
      setTimeout(() => {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
        setTimeout(() => {
          this.status = status;
          this.onload?.();
        }, 10);
      }, 10);
    }
  }
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  return sent;
}

function renderButton() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <UploadButton bucketId="bucket-1" />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('UploadButton', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ objectId: 'o1', uploadUrl: '/api/demo/upload/o1' }), { status: 200 })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows progress while sending and a toast when the upload finishes', async () => {
    const sent = installFakeXhr(200);
    renderButton();
    const file = new File(['hello world'], 'report.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('upload-input'), { target: { files: [file] } });

    expect(await screen.findByText(/Uploading \d+%/)).toBeInTheDocument();
    expect(await screen.findByText('File uploaded')).toBeInTheDocument();
    expect(screen.getByText(/report\.pdf \(11 B\)/)).toBeInTheDocument();
    expect(sent[0]).toMatchObject({ method: 'PUT', url: '/api/demo/upload/o1', body: file });
    await waitFor(() => expect(screen.getByRole('button', { name: /upload file/i })).toBeEnabled());
  });

  it('toasts an error when storage rejects the file', async () => {
    installFakeXhr(500);
    renderButton();
    fireEvent.change(screen.getByTestId('upload-input'), { target: { files: [new File(['x'], 'a.txt')] } });
    expect(await screen.findByText('Could not upload the file')).toBeInTheDocument();
    expect(screen.getByText(/status 500/)).toBeInTheDocument();
  });
});
