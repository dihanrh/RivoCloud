'use client';

import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { sendTourCommand } from './tour-bus';

export const TAKE_TOUR_BUTTON_ID = 'take-tour-button';

/** Starts the guided tour of the home page. */
export function TakeTourButton({ className }: { className?: string }) {
  return (
    <Button
      id={TAKE_TOUR_BUTTON_ID}
      type="button"
      size="lg"
      className={cn('rc-attention', className)}
      aria-haspopup="dialog"
      onClick={() => sendTourCommand('start', null)}
      leftIcon={<Play className="fill-current" aria-hidden />}
    >
      Take a tour
    </Button>
  );
}
