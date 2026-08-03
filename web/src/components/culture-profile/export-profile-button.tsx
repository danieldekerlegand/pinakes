import { useState } from "react";
import { Download, FileDown, Link2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CultureProfile } from "@contracts/types";
import {
  buildCultureProfileReportHtml,
  buildReportFilename,
} from "@/lib/culture-profile-report";

interface ExportProfileButtonProps {
  profile: CultureProfile;
  origin?: string;
}

function getShareUrl(cultureId: string, origin?: string): string {
  const base =
    origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/culture-profile/${cultureId}/report`;
}

function openPrintWindow(html: string): void {
  if (typeof window === "undefined") return;
  const printWindow = window.open("", "_blank", "noopener,noreferrer");
  if (!printWindow) return;
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
}

function downloadHtml(html: string, filename: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function ExportProfileButton({
  profile,
  origin,
}: ExportProfileButtonProps) {
  const [copied, setCopied] = useState(false);

  const handlePrint = () => {
    const html = buildCultureProfileReportHtml({
      profile,
      shareUrl: getShareUrl(profile.id, origin),
    });
    openPrintWindow(html);
  };

  const handleDownload = () => {
    const html = buildCultureProfileReportHtml({
      profile,
      shareUrl: getShareUrl(profile.id, origin),
    });
    downloadHtml(html, buildReportFilename(profile));
  };

  const handleCopyLink = async () => {
    const url = getShareUrl(profile.id, origin);
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      } catch {
        window.prompt("Copy shareable URL", url);
      }
    } else if (typeof window !== "undefined") {
      window.prompt("Copy shareable URL", url);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          data-testid="culture-panel-export"
          aria-label="Export culture profile"
          title="Export profile"
        >
          <Download className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-testid="culture-panel-export-menu">
        <DropdownMenuItem
          onClick={handlePrint}
          data-testid="export-action-print"
        >
          <Printer className="h-4 w-4 mr-2" />
          Print / Save as PDF
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleDownload}
          data-testid="export-action-download"
        >
          <FileDown className="h-4 w-4 mr-2" />
          Download HTML
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleCopyLink}
          data-testid="export-action-share"
        >
          <Link2 className="h-4 w-4 mr-2" />
          {copied ? "Link copied!" : "Copy shareable URL"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
