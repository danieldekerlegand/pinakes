import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Construction } from "lucide-react";

interface ComingSoonProps {
  title: string;
  description?: string;
}

export function ComingSoon({ title, description }: ComingSoonProps) {
  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-100 dark:bg-amber-900/20 rounded-lg">
            <Construction className="h-6 w-6 text-amber-600 dark:text-amber-500" />
          </div>
          <div>
            <CardTitle>{title}</CardTitle>
            {description && (
              <CardDescription className="mt-1">{description}</CardDescription>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg">
            <Construction className="h-5 w-5 text-amber-600 dark:text-amber-500" />
            <span className="text-sm font-medium text-amber-900 dark:text-amber-100">
              Coming Soon
            </span>
          </div>
          <p className="mt-4 text-sm text-muted-foreground max-w-md">
            This feature is being refactored to work with TSV-based storage. Check back soon!
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
