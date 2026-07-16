import type { CultureProfile } from "@shared/types";

const SOCIAL_ORG_LABELS: Record<string, string> = {
  egalitarian: "Egalitarian",
  chiefdom: "Chiefdom",
  state: "State",
  empire: "Empire",
};

const SUBSISTENCE_LABELS: Record<string, string> = {
  "hunter-gatherer": "Hunter-Gatherer",
  pastoral: "Pastoral",
  agricultural: "Agricultural",
  maritime: "Maritime",
  mixed: "Mixed",
};

const URBANISM_LABELS: Record<string, string> = {
  nomadic: "Nomadic",
  village: "Village",
  town: "Town",
  "city-state": "City-State",
  metropolis: "Metropolis",
};

const TECH_LABELS: Record<string, string> = {
  stone: "Stone Age",
  copper: "Copper Age",
  bronze: "Bronze Age",
  iron: "Iron Age",
  steel: "Steel Age",
  industrial: "Industrial",
};

export function formatReportYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

export function formatReportTimePeriod(start: number, end: number): string {
  return `${formatReportYear(start)} \u2013 ${formatReportYear(end)}`;
}

export function formatReportPopulation(pop: number | null | undefined): string {
  if (pop == null) return "Unknown";
  if (pop >= 1_000_000) {
    const value = pop / 1_000_000;
    return `${value.toFixed(pop % 1_000_000 === 0 ? 0 : 1)} million`;
  }
  if (pop >= 1_000) return `${Math.round(pop / 1_000)}K`;
  return pop.toLocaleString();
}

export function humanizeSocialOrganization(value: string): string {
  return SOCIAL_ORG_LABELS[value] || value;
}

export function humanizeSubsistence(value: string): string {
  return SUBSISTENCE_LABELS[value] || value;
}

export function humanizeUrbanism(value: string): string {
  return URBANISM_LABELS[value] || value;
}

export function humanizeTechnology(value: string): string {
  return TECH_LABELS[value] || value;
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface ReportMediaAsset {
  id: string;
  title: string;
  sourceUrl: string;
  license?: string;
  attribution?: string;
  primary?: boolean;
}

export interface ReportSocioCulturalSummary {
  languages?: { id: string; name?: string }[];
  religions?: { id: string; name?: string }[];
  writingSystems?: { id: string; name?: string }[];
  artTraditions?: { id: string; name?: string }[];
  musicTraditions?: { id: string; name?: string }[];
  architecturalStyles?: { id: string; name?: string }[];
  literaryTraditions?: { id: string; name?: string }[];
  cuisine?: { id: string; name?: string } | null;
}

export interface BuildReportOptions {
  profile: CultureProfile;
  media?: ReportMediaAsset[];
  socioCultural?: ReportSocioCulturalSummary;
  shareUrl?: string;
  generatedAt?: Date;
}

export const REPORT_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    color: #1f2937;
    background: #ffffff;
    line-height: 1.55;
    margin: 0;
    padding: 0;
  }
  .report { max-width: 860px; margin: 0 auto; padding: 48px 40px; }
  .cover { border-bottom: 3px double #4338ca; margin-bottom: 28px; padding-bottom: 20px; }
  .eyebrow {
    color: #6b7280;
    font-size: 12px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    margin: 0 0 6px;
  }
  h1 { font-size: 34px; margin: 0 0 8px; color: #1e1b4b; }
  .subtitle { color: #4b5563; margin: 0 0 16px; font-style: italic; }
  .badges { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 16px; }
  .badge {
    display: inline-block;
    font-size: 11px;
    padding: 3px 9px;
    border-radius: 999px;
    border: 1px solid #c7d2fe;
    color: #4338ca;
    background: #eef2ff;
    font-family: system-ui, -apple-system, sans-serif;
  }
  .badge-tech { background: #4338ca; color: #ffffff; border-color: #4338ca; }
  section { margin-bottom: 28px; break-inside: avoid; page-break-inside: avoid; }
  h2 {
    font-size: 20px;
    color: #1e1b4b;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 6px;
    margin: 0 0 14px;
  }
  h3 { font-size: 15px; margin: 14px 0 6px; color: #374151; }
  p { margin: 0 0 10px; }
  .stats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin: 8px 0 16px;
  }
  .stat {
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 10px 12px;
    background: #f9fafb;
  }
  .stat-label {
    color: #6b7280;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-family: system-ui, -apple-system, sans-serif;
    margin: 0 0 2px;
  }
  .stat-value { color: #111827; font-size: 15px; font-weight: 600; margin: 0; }
  .pill-list { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 10px; padding: 0; list-style: none; }
  .pill-list li {
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 12px;
    padding: 3px 9px;
    border: 1px solid #d1d5db;
    border-radius: 999px;
    background: #ffffff;
    color: #374151;
  }
  .gallery { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 12px 0; }
  .gallery figure { margin: 0; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; background: #f9fafb; }
  .gallery img { width: 100%; height: 180px; object-fit: cover; display: block; }
  .gallery figcaption { font-size: 11px; color: #4b5563; padding: 6px 8px; font-family: system-ui, -apple-system, sans-serif; }
  .timeline { margin: 14px 0; font-family: system-ui, -apple-system, sans-serif; }
  .timeline-track { height: 14px; background: #eef2ff; border-radius: 7px; position: relative; overflow: hidden; }
  .timeline-fill { position: absolute; top: 0; bottom: 0; background: #4338ca; border-radius: 7px; }
  .timeline-zero { position: absolute; top: 0; bottom: 0; width: 1px; background: #4b5563; }
  .timeline-axis { display: flex; justify-content: space-between; font-size: 10px; color: #6b7280; margin-top: 4px; }
  .footer {
    margin-top: 36px;
    padding-top: 16px;
    border-top: 1px solid #e5e7eb;
    font-size: 11px;
    color: #6b7280;
    font-family: system-ui, -apple-system, sans-serif;
  }
  .footer a { color: #4338ca; text-decoration: none; }
  .sources { font-size: 12px; color: #4b5563; }
  .no-print { margin: 0 0 20px; text-align: right; font-family: system-ui, -apple-system, sans-serif; }
  .no-print button {
    background: #4338ca;
    color: #ffffff;
    border: 0;
    padding: 8px 14px;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
  }
  @media print {
    body { background: #ffffff; }
    .report { padding: 0; max-width: none; }
    .no-print { display: none !important; }
    a { color: inherit; text-decoration: none; }
    section { page-break-inside: avoid; }
  }
  @page { size: A4; margin: 18mm 16mm; }
`;

function renderPillList(title: string, items: string[]): string {
  if (!items.length) return "";
  const pills = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  return `<h3>${escapeHtml(title)}</h3><ul class="pill-list">${pills}</ul>`;
}

function renderNamedPillList(
  title: string,
  items: { id: string; name?: string }[] | undefined,
): string {
  if (!items || !items.length) return "";
  const labels = items.map((item) => item.name || item.id);
  return renderPillList(title, labels);
}

function renderTimeline(start: number, end: number): string {
  const timelineMin = -5000;
  const timelineMax = 2100;
  const range = timelineMax - timelineMin;
  const left = Math.max(0, Math.min(100, ((start - timelineMin) / range) * 100));
  const width = Math.max(1, Math.min(100 - left, ((end - start) / range) * 100));
  const zeroLeft = ((0 - timelineMin) / range) * 100;
  return `
    <div class="timeline" aria-label="Historical position timeline">
      <div class="timeline-track">
        <span class="timeline-fill" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></span>
        <span class="timeline-zero" style="left:${zeroLeft.toFixed(2)}%"></span>
      </div>
      <div class="timeline-axis"><span>5000 BCE</span><span>0</span><span>2000 CE</span></div>
    </div>
  `;
}

function renderGallery(media: ReportMediaAsset[] | undefined): string {
  if (!media || media.length === 0) return "";
  const items = media
    .slice(0, 8)
    .map((asset) => {
      const caption = [asset.title, asset.attribution].filter(Boolean).join(" \u2014 ");
      return `
        <figure>
          <img src="${escapeHtml(asset.sourceUrl)}" alt="${escapeHtml(asset.title)}" loading="lazy" />
          <figcaption>${escapeHtml(caption)}</figcaption>
        </figure>
      `;
    })
    .join("");
  return `<section><h2>Gallery</h2><div class="gallery">${items}</div></section>`;
}

export function buildCultureProfileReportHtml(options: BuildReportOptions): string {
  const { profile, media, socioCultural, shareUrl, generatedAt } = options;
  const generated = generatedAt ?? new Date();

  const timePeriod = formatReportTimePeriod(profile.timePeriodStart, profile.timePeriodEnd);
  const socialLabel = humanizeSocialOrganization(profile.socialOrganization);
  const subsistenceLabel = humanizeSubsistence(profile.subsistenceType);
  const urbanismLabel = humanizeUrbanism(profile.urbanismLevel);
  const techLabel = humanizeTechnology(profile.technologyLevel);
  const populationLabel = formatReportPopulation(profile.populationEstimate);

  const alternateNames =
    profile.alternateNames.length > 0
      ? `<p class="subtitle">Also known as ${escapeHtml(profile.alternateNames.join(", "))}</p>`
      : "";

  const sharePart = shareUrl
    ? `<p>Shareable URL: <a href="${escapeHtml(shareUrl)}">${escapeHtml(shareUrl)}</a></p>`
    : "";

  const sourcesPart =
    profile.sources.length > 0
      ? `<section class="sources"><h2>Sources</h2><p>${profile.sources.map(escapeHtml).join("; ")}</p></section>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(profile.name)} \u2014 Culture Profile Report</title>
  <style>${REPORT_CSS}</style>
</head>
<body>
  <div class="report" data-culture-id="${escapeHtml(profile.id)}">
    <div class="no-print"><button type="button" onclick="window.print()">Print / Save as PDF</button></div>
    <header class="cover">
      <p class="eyebrow">Culture Profile Report</p>
      <h1>${escapeHtml(profile.name)}</h1>
      ${alternateNames}
      <div class="badges">
        <span class="badge">${escapeHtml(timePeriod)}</span>
        <span class="badge">${escapeHtml(profile.region)}</span>
        <span class="badge badge-tech">${escapeHtml(techLabel)}</span>
        <span class="badge">${escapeHtml(socialLabel)}</span>
      </div>
      <p>${escapeHtml(profile.summaryDescription)}</p>
    </header>

    <section>
      <h2>Overview</h2>
      <div class="stats">
        <div class="stat"><p class="stat-label">Population</p><p class="stat-value">${escapeHtml(populationLabel)}</p></div>
        <div class="stat"><p class="stat-label">Urbanism</p><p class="stat-value">${escapeHtml(urbanismLabel)}</p></div>
        <div class="stat"><p class="stat-label">Technology</p><p class="stat-value">${escapeHtml(techLabel)}</p></div>
        <div class="stat"><p class="stat-label">Subsistence</p><p class="stat-value">${escapeHtml(subsistenceLabel)}</p></div>
      </div>
      ${renderTimeline(profile.timePeriodStart, profile.timePeriodEnd)}
    </section>

    ${renderGallery(media)}

    <section>
      <h2>Socio-Cultural Domains</h2>
      ${renderNamedPillList("Languages", socioCultural?.languages) || renderPillList("Languages", profile.associatedLanguageIds)}
      ${renderNamedPillList("Writing Systems", socioCultural?.writingSystems) || renderPillList("Writing Systems", profile.associatedWritingSystemIds)}
      ${renderNamedPillList("Religions", socioCultural?.religions) || renderPillList("Religions", profile.associatedReligionIds)}
      ${renderNamedPillList("Architectural Styles", socioCultural?.architecturalStyles) || renderPillList("Architectural Styles", profile.associatedArchitecturalStyleIds)}
      ${renderNamedPillList("Art Traditions", socioCultural?.artTraditions) || renderPillList("Art Traditions", profile.associatedArtTraditionIds)}
      ${renderNamedPillList("Music Traditions", socioCultural?.musicTraditions) || renderPillList("Music Traditions", profile.associatedMusicTraditionIds)}
      ${renderNamedPillList("Literary Traditions", socioCultural?.literaryTraditions) || renderPillList("Literary Traditions", profile.associatedLiteraryTraditionIds)}
      ${
        socioCultural?.cuisine
          ? `<h3>Cuisine</h3><p>${escapeHtml(socioCultural.cuisine.name || socioCultural.cuisine.id)}</p>`
          : profile.associatedCuisineId
            ? `<h3>Cuisine</h3><p>${escapeHtml(profile.associatedCuisineId)}</p>`
            : ""
      }
    </section>

    <section>
      <h2>Geography &amp; Settlements</h2>
      <p><strong>Primary region:</strong> ${escapeHtml(profile.region)}</p>
      ${renderPillList("Notable Settlements", profile.notableSettlements)}
    </section>

    ${sourcesPart}

    <footer class="footer">
      <p>Generated ${escapeHtml(generated.toISOString().slice(0, 10))} by pinakes Culture Explorer.</p>
      ${sharePart}
    </footer>
  </div>
</body>
</html>`;
}

export function buildReportFilename(profile: CultureProfile): string {
  const slug = profile.id.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  return `culture-profile-${slug}.html`;
}
