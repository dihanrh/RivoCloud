import { Container, SectionHeading } from './section-heading';
import { DeveloperArt, MediaArt, SaasArt, StoreArt } from './illustrations/use-case-art';

const CASES = [
  {
    title: 'Online stores',
    who: 'Northwind Shop',
    body: 'Keep product pages fast during a sale without caching anyone’s basket.',
    Art: StoreArt,
    tint: 'from-[#fff4e8]',
    steps: [
      'Add your store as a website with your shop server as the origin.',
      'Cache /static/* for 30 days and /products/* for 10 minutes.',
      'Set /cart/* and /account/* to no-store.',
      'Purge /products/* from your admin when prices change.',
    ],
  },
  {
    title: 'Media publishers',
    who: 'Acme Media',
    body: 'Serve images and video from the edge and update a story the moment it changes.',
    Art: MediaArt,
    tint: 'from-[#fdeef4]',
    steps: [
      'Upload images and video to a storage bucket.',
      'Serve the bucket through your media domain so it is cached at the edge.',
      'Tag each article’s responses with a cache tag.',
      'Purge the tag when an editor publishes a correction.',
    ],
  },
  {
    title: 'SaaS apps',
    who: 'Lumen Labs',
    body: 'Let customers upload files and share them privately, without building a file service.',
    Art: SaasArt,
    tint: 'from-[#f3eefa]',
    steps: [
      'Create a private bucket for customer uploads.',
      'Request a presigned URL from the API and upload from the browser.',
      'Turn on signed URLs for the website that serves the files.',
      'Hand customers links that expire after 15 minutes.',
    ],
  },
  {
    title: 'Developers and APIs',
    who: 'Orbitly',
    body: 'Automate everything from CI: deploy, purge and check the numbers.',
    Art: DeveloperArt,
    tint: 'from-[#eef0f3]',
    steps: [
      'Create an API key scoped to zone:read and cache:invalidate.',
      'Store it as a secret in your CI pipeline.',
      'Purge the changed paths after every deploy.',
      'Read cache hit ratio from the analytics API to catch regressions.',
    ],
  },
];

export function UseCases() {
  return (
    <section id="use-cases" aria-labelledby="use-cases-title" className="bg-background py-20 sm:py-28">
      <Container>
        <SectionHeading
          id="use-cases-title"
          kicker="Use cases"
          title="How teams use RivoCloud"
          lede="The same three building blocks, put together in different ways. Here is how four kinds of teams set it up."
        />
        <ul data-tour="use-cases" className="mt-12 grid gap-6 md:grid-cols-2">
          {CASES.map(({ title, who, body, Art, tint, steps }) => (
            <li key={title} data-tour="use-case" className="flex flex-col overflow-hidden rounded-3xl border border-border bg-background">
              <div className={`bg-gradient-to-br ${tint} to-white px-6 pt-6 pb-2 sm:px-10`}>
                <Art />
              </div>
              <div className="flex flex-1 flex-col p-6 sm:p-8">
                <p className="text-[13px] font-medium text-muted-foreground">For example, {who}</p>
                <h3 className="mt-1 text-[22px] font-semibold tracking-tight text-foreground">{title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{body}</p>
                <h4 className="mt-6 text-[13px] font-semibold text-foreground">How to set it up</h4>
                <ol className="mt-3 space-y-2.5">
                  {steps.map((step, i) => (
                    <li key={step} className="flex gap-3 text-[14px] leading-relaxed text-foreground">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[12px] font-semibold text-muted-foreground">
                        {i + 1}
                      </span>
                      <span className="pt-0.5">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
