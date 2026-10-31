'use client';

import { useEffect, useRef } from 'react';

/**
 * A tiny, typed command bus between the guided tour and the interactive
 * sections of the home page. The tour sends explicit commands ("show the
 * storage tab", "open FAQ 2") and each section decides how to apply them to
 * its own state. No DOM clicks, no shared global state.
 */
export type TourCommands = {
  /** Start the tour from the beginning. */
  start: null;
  /** Select a product tab by feature id. */
  products: string;
  /** Select a how-it-works step by index. */
  how: number;
  /** Select a code sample language. */
  code: 'curl' | 'js' | 'cli';
  /** Select a performance chart metric. */
  metric: 'requests' | 'bandwidth' | 'hit';
  /** Open an FAQ entry by index. */
  faq: number;
};

export type TourChannel = keyof TourCommands;

type Listener<K extends TourChannel> = (value: TourCommands[K]) => void;

const listeners = new Map<TourChannel, Set<Listener<TourChannel>>>();

export function sendTourCommand<K extends TourChannel>(channel: K, value: TourCommands[K]) {
  const set = listeners.get(channel);
  if (!set) return;
  for (const listener of Array.from(set)) (listener as Listener<K>)(value);
}

export function subscribeTourCommand<K extends TourChannel>(channel: K, listener: Listener<K>) {
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
  }
  set.add(listener as Listener<TourChannel>);
  return () => {
    set.delete(listener as Listener<TourChannel>);
  };
}

/** Run `handler` whenever the tour sends a command on `channel`. */
export function useTourCommand<K extends TourChannel>(channel: K, handler: Listener<K>) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => subscribeTourCommand(channel, (value) => ref.current(value)), [channel]);
}
