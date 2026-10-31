import { sendTourCommand } from './tour-bus';
import { FEATURES } from '../feature-tabs';
import { STEPS as HOW_STEPS } from '../how-it-works';
import { FAQS } from '../faq';

/** Something the tour does part-way through a step, `at` ms after it starts. */
export type TourAction = {
  at: number;
  run: () => void;
  /** Short label shown on the caption card while this part is on screen. */
  label?: string;
  /** Spotlight a different element (CSS selector) from this point on. */
  target?: string;
  /** Which matching element to use when `target` matches several. */
  targetIndex?: number;
};

export type TourStep = {
  id: string;
  title: string;
  body: string;
  /** One or more CSS selectors; the spotlight covers all of them. */
  target: string[];
  /** How long the step stays on screen before moving on, in ms. */
  duration: number;
  actions?: TourAction[];
};

const BASE = 6000;
const SUB = 3000;
const noop = () => {};

const FEATURE_COPY: Record<string, string> = {
  caching: 'Point RivoCloud at your server and every edge answers from cache first. You decide what is cached, for how long, and purge it in seconds.',
  storage: 'Buckets for images, videos and uploads, right next to the CDN. Files go straight from the browser to storage.',
  'signed-urls': 'Share private files with links that expire. The edge checks every signature before it serves a byte.',
  analytics: 'Every request is counted, not sampled: traffic, bandwidth, cache hit ratio and response times.',
  domains: 'Bring your own domain. RivoCloud verifies it and keeps an HTTPS certificate renewed for you.',
  teams: 'Invite your team with clear roles, give automations narrowly scoped API keys, and see every change in the audit log.',
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'products',
    title: 'Three products, one console',
    body: 'Websites, storage and analytics share one edge network, one team and one API. Let’s look at each feature in turn.',
    target: ['[data-tour="products-intro"]', '[data-tour="products-tabs"]'],
    duration: BASE,
    actions: [{ at: 0, run: () => sendTourCommand('products', FEATURES[0].id) }],
  },
  ...FEATURES.map<TourStep>((feature) => ({
    id: `feature-${feature.id}`,
    title: feature.label,
    body: FEATURE_COPY[feature.id] ?? feature.body,
    target: ['[data-tour="products-panel"]'],
    duration: BASE,
    actions: [{ at: 0, run: () => sendTourCommand('products', feature.id) }],
  })),
  {
    id: 'how-it-works',
    title: 'How it works',
    body: 'From your server to a visitor’s screen in four steps. Watch the diagram light up the path for each one.',
    target: ['[data-tour="how-it-works"]'],
    duration: SUB * HOW_STEPS.length,
    actions: HOW_STEPS.map((step, index) => ({
      at: index * SUB,
      run: () => sendTourCommand('how', index),
      label: `${index + 1}. ${step.title}`,
    })),
  },
  {
    id: 'use-cases',
    title: 'Use cases',
    body: 'Stores, publishers, SaaS apps and developer teams put the same building blocks together in different ways.',
    target: ['[data-tour="use-cases"]'],
    duration: 2500 * 4,
    actions: ['Online stores', 'Media publishers', 'SaaS apps', 'Developers and APIs'].map((label, index) => ({
      at: index * 2500,
      run: noop,
      label,
      target: '[data-tour="use-case"]',
      targetIndex: index,
    })),
  },
  {
    id: 'developers',
    title: 'Built for developers',
    body: 'Everything you can do in the console is also an API call. Here is the same task with cURL, the JavaScript SDK and the CLI.',
    target: ['[data-tour="code-samples"]'],
    duration: SUB * 3,
    actions: [
      { at: 0, run: () => sendTourCommand('code', 'curl'), label: 'cURL' },
      { at: SUB, run: () => sendTourCommand('code', 'js'), label: 'JavaScript' },
      { at: SUB * 2, run: () => sendTourCommand('code', 'cli'), label: 'CLI' },
    ],
  },
  {
    id: 'performance',
    title: 'Live analytics',
    body: 'See how fast you are everywhere. Switch between requests, bandwidth and cache hit ratio for any time range.',
    target: ['[data-tour="performance"]'],
    duration: SUB * 3,
    actions: [
      { at: 0, run: () => sendTourCommand('metric', 'requests'), label: 'Requests' },
      { at: SUB, run: () => sendTourCommand('metric', 'bandwidth'), label: 'Bandwidth' },
      { at: SUB * 2, run: () => sendTourCommand('metric', 'hit'), label: 'Cache hit ratio' },
    ],
  },
  {
    id: 'testimonials',
    title: 'Trusted by busy teams',
    body: 'Online stores, media companies and SaaS teams use RivoCloud to keep pages fast and files safe.',
    target: ['[data-tour="testimonials"]'],
    duration: BASE,
  },
  {
    id: 'faq',
    title: 'Questions, answered',
    body: 'Short, plain answers to the questions teams ask most, like how fast a purge reaches every edge.',
    target: ['[data-tour="faq"]'],
    duration: BASE + 1000,
    actions: [{ at: 0, run: () => sendTourCommand('faq', 1), label: FAQS[1].q }],
  },
];
