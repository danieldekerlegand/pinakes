import { useState } from "react";
import { X, Filter, Database, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface FiltersSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  filters: {
    status: string[];
    region: string;
    speakers: string;
  };
  onFiltersChange: (filters: any) => void;
}

export default function FiltersSidebar({ isOpen, onClose, filters, onFiltersChange }: FiltersSidebarProps) {
  const statusOptions = [
    { id: "living", label: "Living", count: 156 },
    { id: "endangered", label: "Endangered", count: 89 },
    { id: "extinct", label: "Extinct", count: 234 },
    { id: "proto", label: "Proto-language", count: 45 },
    { id: "historical", label: "Historical", count: 67 },
  ];

  const regionOptions = [
    "Europe",
    "Asia",
    "Africa", 
    "North America",
    "South America",
    "Oceania",
    "Middle East",
  ];

  const speakerRanges = [
    { value: "any", label: "Any" },
    { value: "1000000+", label: "1M+ speakers" },
    { value: "100000-1000000", label: "100K - 1M speakers" },
    { value: "10000-100000", label: "10K - 100K speakers" },
    { value: "1000-10000", label: "1K - 10K speakers" },
    { value: "0-1000", label: "< 1K speakers" },
  ];

  const updateStatusFilter = (statusId: string, checked: boolean) => {
    const newStatus = checked
      ? [...filters.status, statusId]
      : filters.status.filter(s => s !== statusId);

    onFiltersChange({
      ...filters,
      status: newStatus,
    });
  };

  const clearAllFilters = () => {
    onFiltersChange({
      status: [],
      region: "all-regions",
      speakers: "any",
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 lg:relative lg:bg-transparent lg:inset-auto lg:z-auto" role="dialog" aria-modal="true" aria-label="Filter languages">
      <div className="fixed right-0 top-0 h-full w-80 bg-white shadow-material-3 overflow-y-auto lg:relative lg:w-full lg:shadow-none">
        <aside className="p-6" aria-label="Language filters">
          <div className="flex items-center justify-between mb-6 lg:hidden">
            <div className="flex items-center space-x-2">
              <Filter className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 className="text-lg font-medium text-gray-900">Filters</h2>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
              data-testid="button-close-filters"
              aria-label="Close filters"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </Button>
          </div>

          <div className="space-y-6">
            {/* Data Source */}
            <div>
              <h3 className="text-sm font-medium text-gray-900 mb-3">Data Source</h3>
              <p className="text-sm text-gray-600 italic">
                All languages from NorthEuraLex database. Languages with scraped word lists are marked with a "Word List" badge.
              </p>
            </div>

            {/* Language Status */}
            <div>
              <h3 className="text-sm font-medium text-gray-900 mb-3">Language Status</h3>
              <div className="space-y-2">
                {statusOptions.map((option) => (
                  <div key={option.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={option.id}
                      checked={filters.status.includes(option.id)}
                      onCheckedChange={(checked) => updateStatusFilter(option.id, !!checked)}
                      data-testid={`checkbox-status-${option.id}`}
                    />
                    <label
                      htmlFor={option.id}
                      className="text-sm text-gray-700 flex-1 cursor-pointer"
                    >
                      {option.label}
                    </label>
                    <span className="text-xs text-gray-500">{option.count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Geographic Region */}
            <div>
              <h3 className="text-sm font-medium text-gray-900 mb-3">Geographic Region</h3>
              <Select
                value={filters.region}
                onValueChange={(value) => onFiltersChange({ ...filters, region: value })}
              >
                <SelectTrigger data-testid="select-region">
                  <SelectValue placeholder="Select region..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all-regions">All regions</SelectItem>
                  {regionOptions.map((region) => (
                    <SelectItem key={region} value={region}>
                      {region}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Speaker Count */}
            <div>
              <h3 className="text-sm font-medium text-gray-900 mb-3">Speaker Count</h3>
              <Select
                value={filters.speakers}
                onValueChange={(value) => onFiltersChange({ ...filters, speakers: value })}
              >
                <SelectTrigger data-testid="select-speakers">
                  <SelectValue placeholder="Select range..." />
                </SelectTrigger>
                <SelectContent>
                  {speakerRanges.map((range) => (
                    <SelectItem key={range.value} value={range.value}>
                      {range.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Clear Filters */}
            <div className="pt-4 border-t border-gray-200">
              <Button
                variant="outline"
                size="sm"
                onClick={clearAllFilters}
                className="w-full"
                data-testid="button-clear-filters"
              >
                Clear All Filters
              </Button>
            </div>

            {/* Applied Filters Summary */}
            {(filters.status.length > 0 || (filters.region && filters.region !== "all-regions") || filters.speakers) && (
              <Card className="p-4 bg-blue-50 border-blue-200">
                <h4 className="text-sm font-medium text-blue-900 mb-2">Active Filters</h4>
                <div className="space-y-1 text-xs text-blue-700">
                  {filters.status.length > 0 && (
                    <p>Status: {filters.status.join(", ")}</p>
                  )}
                  {filters.region && filters.region !== "all-regions" && <p>Region: {filters.region}</p>}
                  {filters.speakers && (
                    <p>Speakers: {speakerRanges.find(r => r.value === filters.speakers)?.label}</p>
                  )}
                </div>
              </Card>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}