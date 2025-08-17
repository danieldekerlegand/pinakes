import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { List, FolderSync, Download, X } from "lucide-react";

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

const statusFilters = [
  { id: 'living', label: 'Living', count: 3247, color: 'bg-success' },
  { id: 'endangered', label: 'Endangered', count: 1823, color: 'bg-warning' },
  { id: 'moribund', label: 'Moribund', count: 456, color: 'bg-red-600' },
  { id: 'dead', label: 'Dead/Extinct', count: 892, color: 'bg-gray-600' },
];

const speakerRanges = [
  { id: '1m+', label: '1M+ speakers' },
  { id: '100k-1m', label: '100K - 1M speakers' },
  { id: '10k-100k', label: '10K - 100K speakers' },
  { id: '<10k', label: '< 10K speakers' },
];

const regions = [
  'All Regions',
  'Europe',
  'Asia', 
  'Africa',
  'Americas',
  'Oceania'
];

export default function FiltersSidebar({ isOpen, onClose, filters, onFiltersChange }: FiltersSidebarProps) {
  const handleStatusChange = (statusId: string, checked: boolean) => {
    const newStatus = checked
      ? [...filters.status, statusId]
      : filters.status.filter(s => s !== statusId);
    
    onFiltersChange({
      ...filters,
      status: newStatus,
    });
  };

  const handleRegionChange = (region: string) => {
    onFiltersChange({
      ...filters,
      region: region === 'All Regions' ? '' : region,
    });
  };

  const handleSpeakersChange = (speakers: string) => {
    onFiltersChange({
      ...filters,
      speakers,
    });
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
          onClick={onClose}
        />
      )}
      
      <aside className={`
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0 fixed md:relative z-50 md:z-auto
        w-80 bg-white shadow-material-1 min-h-screen transition-transform duration-300 ease-in-out
      `}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-gray-900">Filters</h2>
            <Button
              variant="ghost"
              size="sm"
              className="md:hidden"
              onClick={onClose}
              data-testid="button-close-sidebar"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Language Status Filter */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Language Status</h3>
            <div className="space-y-2">
              {statusFilters.map(status => (
                <div key={status.id} className="flex items-center space-between">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id={status.id}
                      checked={filters.status.includes(status.id)}
                      onCheckedChange={(checked) => handleStatusChange(status.id, !!checked)}
                      className="border-gray-300"
                      data-testid={`checkbox-status-${status.id}`}
                    />
                    <Label htmlFor={status.id} className="text-sm cursor-pointer">
                      {status.label}
                    </Label>
                  </div>
                  <Badge 
                    className={`ml-auto text-xs ${status.color} text-white`}
                    data-testid={`badge-count-${status.id}`}
                  >
                    {status.count.toLocaleString()}
                  </Badge>
                </div>
              ))}
            </div>
          </div>

          {/* Geographic Region Filter */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Geographic Region</h3>
            <Select
              value={filters.region || 'All Regions'}
              onValueChange={handleRegionChange}
            >
              <SelectTrigger className="w-full" data-testid="select-region">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {regions.map(region => (
                  <SelectItem key={region} value={region}>
                    {region}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Speaker Count Filter */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Number of Speakers</h3>
            <RadioGroup
              value={filters.speakers}
              onValueChange={handleSpeakersChange}
              data-testid="radio-group-speakers"
            >
              {speakerRanges.map(range => (
                <div key={range.id} className="flex items-center space-x-2">
                  <RadioGroupItem value={range.id} id={range.id} />
                  <Label htmlFor={range.id} className="text-sm cursor-pointer">
                    {range.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Quick Actions */}
          <div className="border-t pt-6">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Quick Actions</h3>
            <div className="space-y-2">
              <Button
                variant="ghost"
                className="w-full justify-start text-primary hover:bg-blue-50"
                data-testid="button-manage-base-words"
              >
                <List className="h-4 w-4 mr-2" />
                Manage Base Word List
              </Button>
              <Button
                variant="ghost" 
                className="w-full justify-start text-primary hover:bg-blue-50"
                data-testid="button-refresh-all"
              >
                <FolderSync className="h-4 w-4 mr-2" />
                Refresh All Word Lists
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start text-primary hover:bg-blue-50"
                data-testid="button-export-data"
              >
                <Download className="h-4 w-4 mr-2" />
                Export Data
              </Button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
