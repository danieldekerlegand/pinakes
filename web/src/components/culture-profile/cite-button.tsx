import { useState } from "react";
import { Quote, FileDown, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * "Cite" action for an entity detail panel (US-008). Downloads / copies an academic
 * citation built server-side from the entity's `sources[]` by `/api/citations/*`.
 * Entities with missing/partial sources still yield a usable record-level citation.
 */
interface CiteButtonProps {
  /** The citation domain, e.g. `"culture-profiles"`. */
  domain: string;
  /** The entity id. */
  entityId: string;
  /** A base filename stem (slugged server-side); usually the entity name/id. */
  filename?: string;
}

type CitationFormat = "bibtex" | "ris" | "csljson";

const FORMAT_EXT: Record<CitationFormat, string> = {
  bibtex: "bib",
  ris: "ris",
  csljson: "json",
};

function citationUrl(domain: string, entityId: string, format: CitationFormat): string {
  return `/api/citations/${encodeURIComponent(domain)}/${encodeURIComponent(entityId)}?format=${format}`;
}

async function fetchCitation(domain: string, entityId: string, format: CitationFormat): Promise<string> {
  const res = await fetch(citationUrl(domain, entityId, format));
  if (!res.ok) throw new Error(`Citation request failed (${res.status})`);
  return res.text();
}

function triggerDownload(content: string, filename: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function CiteButton({ domain, entityId, filename }: CiteButtonProps) {
  const [copied, setCopied] = useState(false);
  const stem = (filename ?? entityId).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "citation";

  const handleDownload = async (format: CitationFormat) => {
    try {
      const content = await fetchCitation(domain, entityId, format);
      triggerDownload(content, `${stem}.${FORMAT_EXT[format]}`);
    } catch {
      // network / server error — silently ignore; the panel remains usable
    }
  };

  const handleCopyBibtex = async () => {
    try {
      const content = await fetchCitation(domain, entityId, "bibtex");
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      } else if (typeof window !== "undefined") {
        window.prompt("Copy BibTeX", content);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          data-testid="culture-panel-cite"
          aria-label="Cite this entity"
          title="Cite this entity"
        >
          <Quote className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-testid="culture-panel-cite-menu">
        <DropdownMenuLabel>Cite this record</DropdownMenuLabel>
        <DropdownMenuItem onClick={handleCopyBibtex} data-testid="cite-action-copy-bibtex">
          {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
          {copied ? "BibTeX copied!" : "Copy BibTeX"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => handleDownload("bibtex")} data-testid="cite-action-download-bibtex">
          <FileDown className="h-4 w-4 mr-2" />
          Download BibTeX (.bib)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleDownload("ris")} data-testid="cite-action-download-ris">
          <FileDown className="h-4 w-4 mr-2" />
          Download RIS (.ris)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleDownload("csljson")} data-testid="cite-action-download-csl">
          <FileDown className="h-4 w-4 mr-2" />
          Download CSL-JSON (.json)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
