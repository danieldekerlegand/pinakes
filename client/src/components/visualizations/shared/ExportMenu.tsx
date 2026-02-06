import React, { useState } from 'react';
import { Download, FileDown, FileImage, FileText } from 'lucide-react';
import { Button } from '../../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '../../ui/dropdown-menu';
import { exportSVG, exportPNG, exportCSV, exportJSON } from '../../../lib/visualization/export-utils';
import { useToast } from '../../../hooks/use-toast';

interface ExportMenuProps {
  svgRef?: React.RefObject<SVGSVGElement>;
  data?: any;
  currentView: string;
}

export function ExportMenu({ svgRef, data, currentView }: ExportMenuProps) {
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

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
              Export as PNG
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
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
