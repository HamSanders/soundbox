/**
 * One search landing page, rendered from `landers/content.ts`.
 *
 * The shape follows what a visitor arriving from a search needs, in order: a
 * single promise and a download button above the fold, something to hear at
 * once, a short numbered list of what it does (each with a real sound where
 * there is one), an honest comparison where the page is about an alternative,
 * the questions people actually ask, and the installers again at the bottom.
 * Pages link to each other and are in the sitemap, but not in the top nav.
 */

import { Link } from "react-router-dom";

import { DownloadButton, PlatformPicker } from "@/components/download-cta";
import { SamplePlay } from "@/components/sample-play";
import { faqJsonLd, breadcrumbJsonLd, SeoHead } from "@/components/seo-head";
import { assetUrl } from "@/lib/asset-url";
import { REPO_URL } from "@/lib/marketing-links";
import { getLander, LANDERS, type Lander } from "../landers/content";

/** README, "Compared with a hosted service", row for row. */
const COMPARISON: [string, string, string][] = [
  ["Runs on", "Their GPUs", "Your machine"],
  ["Cost", "Subscription or credits", "Your electricity"],
  ["Account", "Required", "None"],
  ["Models", "Closed, tuned, consistent", "Open weights; quality varies by model"],
  [
    "Output rights",
    "Their terms of service",
    "The licence of the model that made it, shown up front",
  ],
  ["Offline", "No", "Yes, once the weights are downloaded"],
  ["Agents", "HTTP API", "HTTP API and an MCP server"],
  ["Source", "Closed", "MIT"],
];

function Block({
  id,
  label,
  title,
  children,
}: {
  id?: string;
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id ?? label}-h`}
      className="border-border/60 scroll-mt-16 border-t px-4 py-16 sm:py-20"
    >
      <div className="mx-auto w-full max-w-5xl">
        <p className="label-caps text-muted-foreground">{label}</p>
        <h2 id={`${id ?? label}-h`} className="mt-2 text-3xl sm:text-4xl">
          {title}
        </h2>
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}

function LanderPage({ lander }: { lander: Lander }) {
  const related = lander.related
    .map((path) => getLander(path))
    .filter((l): l is Lander => Boolean(l));

  return (
    <main id="main">
      <SeoHead
        title={lander.seoTitle}
        description={lander.seoDescription}
        path={`/${lander.path}`}
        jsonLd={[
          faqJsonLd(lander.faq.map((f) => ({ question: f.question, answer: f.answer }))),
          breadcrumbJsonLd([
            { name: "Soundbox", path: "/" },
            { name: lander.eyebrow.split(" · ")[1] ?? lander.headline, path: `/${lander.path}` },
          ]),
        ]}
      />

      {/* ------------------------------------------------------------ hero */}
      <section aria-labelledby="lander-h1" className="px-4">
        <div className="mx-auto w-full max-w-3xl py-16 text-center sm:py-24">
          <p className="label-caps text-muted-foreground">{lander.eyebrow}</p>
          <h1 id="lander-h1" className="mt-4 text-4xl text-balance sm:text-6xl">
            {lander.headline}
          </h1>
          <p className="text-muted-foreground mx-auto mt-5 max-w-xl text-base leading-relaxed text-pretty sm:text-lg">
            {lander.lede}
          </p>

          <DownloadButton pickerHref="#download" className="mt-8" />
          <p className="mt-3 text-xs">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="text-muted-foreground hover:text-foreground underline underline-offset-4"
            >
              Read the source
            </a>
          </p>

          <div className="border-border mx-auto mt-10 max-w-md rounded-md border p-3 text-left">
            <p className="label-caps text-muted-foreground mb-2">Hear one first</p>
            <SamplePlay id={lander.hero} />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- tricks */}
      <Block id="what" label="What it does" title={lander.tricksTitle}>
        <ol className="border-border grid border-t border-l sm:grid-cols-2 lg:grid-cols-3">
          {lander.tricks.map((trick, i) => (
            <li key={trick.title} className="border-border flex flex-col gap-3 border-r border-b p-5">
              <span className="readout text-muted-foreground text-xs" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="text-base font-semibold tracking-tight">{trick.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{trick.body}</p>
              {trick.sample ? <SamplePlay id={trick.sample} className="mt-auto pt-2" /> : null}
            </li>
          ))}
        </ol>

        <figure className="border-border mt-10 overflow-hidden rounded-md border">
          <img
            src={assetUrl(lander.shot.src)}
            alt={lander.shot.alt}
            loading="lazy"
            className="block h-auto w-full"
          />
        </figure>
      </Block>

      {/* --------------------------------------------------------- compare */}
      {lander.compare ? (
        <Block id="compare" label="Is it for you?" title={lander.compare}>
          <div className="border-border overflow-x-auto rounded-md border">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead>
                <tr className="border-border border-b">
                  <th scope="col" className="p-3" />
                  <th scope="col" className="label-caps text-muted-foreground p-3 font-normal">
                    Hosted (ElevenLabs, Suno and similar)
                  </th>
                  <th scope="col" className="label-caps p-3 font-normal">
                    Soundbox
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map(([row, hosted, ours]) => (
                  <tr key={row} className="border-border border-b last:border-b-0">
                    <th scope="row" className="text-muted-foreground p-3 font-normal">
                      {row}
                    </th>
                    <td className="text-muted-foreground p-3">{hosted}</td>
                    <td className="p-3">{ours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
            Hosted services differ from one another and change their terms; this describes them in
            general, not any one product&apos;s current plan.
          </p>
        </Block>
      ) : null}

      {/* ------------------------------------------------------------- faq */}
      <Block id="questions" label="Questions" title="What people ask first">
        <dl className="max-w-3xl space-y-7">
          {lander.faq.map((f) => (
            <div key={f.question}>
              <dt className="font-semibold tracking-tight">{f.question}</dt>
              <dd className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{f.answer}</dd>
            </div>
          ))}
        </dl>
      </Block>

      {/* -------------------------------------------------------- download */}
      <Block id="download" label="Download" title="Free, and on your machine">
        <PlatformPicker />
        <div className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {related.map((l) => (
            <Link
              key={l.path}
              to={`/${l.path}`}
              className="text-muted-foreground hover:text-foreground underline underline-offset-4"
            >
              {l.headline}
            </Link>
          ))}
          <Link
            to="/models"
            className="text-muted-foreground hover:text-foreground underline underline-offset-4"
          >
            Every model and its licence
          </Link>
        </div>
      </Block>
    </main>
  );
}

const cache = new Map<string, () => React.JSX.Element>();

/** A stable route component for one lander, so the router never remounts it. */
export function landerComponent(path: string): () => React.JSX.Element {
  let c = cache.get(path);
  if (!c) {
    const lander = getLander(path);
    if (!lander) throw new Error(`No lander at ${path}`);
    c = () => <LanderPage lander={lander} />;
    cache.set(path, c);
  }
  return c;
}

export const LANDER_PATHS = LANDERS.map((l) => l.path);
