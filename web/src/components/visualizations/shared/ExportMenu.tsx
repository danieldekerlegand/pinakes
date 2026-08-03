import React, { useState } from 'react';
import { Download, FileDown, FileImage, FileText, Code, Check, Copy } from 'lucide-react';
import { Button } from '../../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '../../ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../ui/dialog';
import { exportSVG, exportPNG, exportCSV, exportJSON, generateEmbedCode, copyToClipboard } from '../../../lib/visualization/export-utils';
import { useToast } from '../../../hooks/use-toast';

interface ExportMenuProps {
  svgRef?: React.RefObject<SVGSVGElement>;
  data?: any;
  currentView: string;
}

export function ExportMenu({ svgRef, data, currentView }: ExportMenuProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [embedDialogOpen, setEmbedDialogOpen] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  const { toast } = useToast();

  const embedCode = generateEmbedCode(window.location.origin, {
    view: currentView,
    width: '100%',
    height: 500,
    theme: 'light',
  });

  const handleCopyEmbed = async () => {
    const success = await copyToClipboard(embedCode);
    if (success) {
      setEmbedCopied(true);
      toast({ title: 'Copied', description: 'Embed code copied to clipboard' });
      setTimeout(() => setEmbedCopied(false), 2000);
    }
  };

  const handleExportSVG = async () => {
    if (!svgRef?.current) {
      toast({
        title: 'Export Failed',
        description: 'SVG element not found',
        variant: 'destructive',
      });
      return;
    }

    setIsExporting(true);
    const filename = `language-${currentView}-${Date.now()}.svg`;
    const success = exportSVG(svgRef.current, filename);

    if (success) {
      toast({
        title: 'Export Successful',
        description: `Visualization exported as ${filename}`,
      });
    } else {
      toast({
        title: 'Export Failed',
        description: 'Could not export SVG file',
        variant: 'destructive',
      });
    }

    setIsExporting(false);
  };

  const handleExportPNG = async () => {
    if (!svgRef?.current) {
      toast({
        title: 'Export Failed',
        description: 'SVG element not found',
        variant: 'destructive',
      });
      return;
    }

    setIsExporting(true);
    const filename = `language-${currentView}-${Date.now()}.png`;
    const success = await exportPNG(svgRef.current, filename);

    if (success) {
      toast({
        title: 'Export Successful',
        description: `Visualization exported as ${filename}`,
      });
    } else {
      toast({
        title: 'Export Failed',
        description: 'Could not export PNG file',
        variant: 'destructive',
      });
    }

    setIsExporting(false);
  };

  const handleExportCSV = () => {
    if (!data || (Array.isArray(data) && data.length === 0)) {
      toast({
        title: 'Export Failed',
        description: 'No data available to export',
        variant: 'destructive',
      });
      return;
    }

    setIsExporting(true);
    const filename = `language-${currentView}-data-${Date.now()}.csv`;
    const success = exportCSV(Array.isArray(data) ? data : [data], filename);

    if (success) {
      toast({
        title: 'Export Successful',
        description: `Data exported as ${filename}`,
      });
    } else {
      toast({
        title: 'Export Failed',
        description: 'Could not export CSV file',
        variant: 'destructive',
      });
    }

    setIsExporting(false);
  };

  const handleExportJSON = () => {
    if (!data) {
      toast({
        title: 'Export Failed',
        description: 'No data available to export',
        variant: 'destructive',
      });
      return;
    }

    setIsExporting(true);
    const filename = `language-${currentView}-data-${Date.now()}.json`;
    const success = exportJSON(data, filename);

    if (success) {
      toast({
        title: 'Export Successful',
        description: `Data exported as ${filename}`,
      });
    } else {
      toast({
        title: 'Export Failed',
        description: 'Could not export JSON file',
        variant: 'destructive',
      });
    }

    setIsExporting(false);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={isExporting}>
            <Download className="h-4 w-4 mr-2" />
            {isExporting ? 'Exporting...' : 'Export'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {svgRef && (
            <>
              <DropdownMenuItem onClick={handleExportSVG}>
                <FileImage className="h-4 w-4 mr-2" />
                Export as SVG
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportPNG}>
                <FileImage className="h-4 w-4 mr-2" />
                Export as PNG (with watermark)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {data && (
            <>
              <DropdownMenuItem onClick={handleExportCSV}>
                <FileText className="h-4 w-4 mr-2" />
                Export Data as CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportJSON}>
                <FileDown className="h-4 w-4 mr-2" />
                Export Data as JSON
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onClick={() => setEmbedDialogOpen(true)}>
            <Code className="h-4 w-4 mr-2" />
            Get Embed Code
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={embedDialogOpen} onOpenChange={setEmbedDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Embed Visualization</DialogTitle>
            <DialogDescription>
              Copy the code below to embed this {currentView} visualization on your website.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="relative">
              <pre className="bg-gray-100 rounded-md p-3 text-xs overflow-x-auto whitespace-pre-wrap break-all font-mono">
                {embedCode}
              </pre>
              <Button
                variant="outline"
                size="sm"
                className="absolute top-2 right-2"
                onClick={handleCopyEmbed}
              >
                {embedCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              The embed is responsive and will adapt to its container width. Adjust the height value in the code as needed.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
