import './test-polyfills';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Button } from './button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem } from './dropdown-menu';
import { Field } from './field';
import { Input } from './input';
import { Switch } from './switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { ToastProvider, useToast } from './toast';
import { Tooltip, TooltipProvider } from './tooltip';

function ToastDemo() {
  const toast = useToast();
  return <button onClick={() => toast.success('Bucket created', 'media-assets is ready.')}>Fire</button>;
}

describe('Toast', () => {
  it('appears with role="status" and auto-dismisses after 5 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(
        <ToastProvider>
          <ToastDemo />
        </ToastProvider>,
      );
      act(() => screen.getByText('Fire').click());
      expect(screen.getByRole('status')).toHaveTextContent('Bucket created');
      expect(screen.getByText('media-assets is ready.')).toBeInTheDocument();
      await act(async () => {
        vi.advanceTimersByTime(5200);
      });
      expect(screen.queryByText('Bucket created')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('can be dismissed with its close button', async () => {
    render(
      <ToastProvider>
        <ToastDemo />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByText('Fire'));
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    await waitFor(() => expect(screen.queryByText('Bucket created')).not.toBeInTheDocument());
  });
});

describe('DropdownMenu', () => {
  it('opens from the keyboard, moves with arrows/Home/End and selects with Enter', async () => {
    const onOpen = vi.fn();
    const onDelete = vi.fn();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Actions</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <MenuItem onSelect={onOpen}>Open</MenuItem>
          <MenuItem>Copy ID</MenuItem>
          <MenuItem tone="destructive" onSelect={onDelete}>
            Delete
          </MenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const user = userEvent.setup();
    screen.getByRole('button', { name: 'Actions' }).focus();
    await user.keyboard('{Enter}');
    const items = await screen.findAllByRole('menuitem');
    expect(items).toHaveLength(3);
    await waitFor(() => expect(items[0]).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
    await user.keyboard('{End}');
    expect(items[2]).toHaveFocus();
    await user.keyboard('{Home}');
    expect(items[0]).toHaveFocus();
    await user.keyboard('{ArrowUp}'); // wraps from the first item to the last
    expect(items[2]).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Actions</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <MenuItem>Open</MenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Actions' });
    trigger.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menu');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});

describe('Tooltip', () => {
  it('shows its content when the trigger receives keyboard focus', async () => {
    render(
      <TooltipProvider>
        <Tooltip content="Copy hostname">
          <Button size="icon-sm" aria-label="Copy hostname">
            C
          </Button>
        </Tooltip>
      </TooltipProvider>,
    );
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Copy hostname' })).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Copy hostname');
  });
});

describe('Tabs', () => {
  function Demo() {
    return (
      <Tabs defaultValue="overview">
        <TabsList aria-label="Sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">Overview panel</TabsContent>
        <TabsContent value="files">Files panel</TabsContent>
        <TabsContent value="settings">Settings panel</TabsContent>
      </Tabs>
    );
  }

  it('uses roving focus: arrows/Home/End move and select, only the selected tab is tabbable', async () => {
    render(<Demo />);
    const user = userEvent.setup();
    const [overview, files, settings] = screen.getAllByRole('tab');
    expect(overview).toHaveAttribute('tabindex', '0');
    expect(files).toHaveAttribute('tabindex', '-1');

    await user.tab();
    expect(overview).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(files).toHaveFocus();
    expect(files).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Files panel');

    await user.keyboard('{End}');
    expect(settings).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(overview).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(settings).toHaveFocus();
    await user.keyboard('{Home}');
    expect(overview).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Overview panel');
  });
});

describe('Switch', () => {
  it('toggles aria-checked when clicked and calls onCheckedChange', async () => {
    const spy = vi.fn();
    function Demo() {
      const [on, setOn] = useState(false);
      return (
        <Switch
          checked={on}
          label="Serve traffic"
          onCheckedChange={(v) => {
            spy(v);
            setOn(v);
          }}
        />
      );
    }
    render(<Demo />);
    const sw = screen.getByRole('switch', { name: 'Serve traffic' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(spy).toHaveBeenLastCalledWith(true);
    sw.focus();
    await userEvent.keyboard(' ');
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });

  it('is disabled while loading', () => {
    render(<Switch checked label="Serve traffic" loading />);
    expect(screen.getByRole('switch', { name: 'Serve traffic' })).toBeDisabled();
  });
});

describe('Field', () => {
  it('wires the label, hint and error to the control', () => {
    const { rerender } = render(
      <Field label="Bucket name" hint="Lowercase letters only.">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText('Bucket name');
    expect(input).toHaveAccessibleDescription('Lowercase letters only.');
    expect(input).not.toHaveAttribute('aria-invalid');

    rerender(
      <Field label="Bucket name" hint="Lowercase letters only." error="Name is taken.">
        <Input />
      </Field>,
    );
    expect(screen.getByLabelText('Bucket name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Bucket name')).toHaveAccessibleDescription('Name is taken.');
  });
});
