import * as React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface DetailDrawerProps {
  /** Whether the drawer is open */
  isOpen: boolean;
  /** Called when the drawer should close (overlay click, close button, Escape) */
  onClose: () => void;
  /** Width of the drawer panel. Defaults to "md" (384px / w-96) */
  width?: "sm" | "md" | "lg" | "xl" | "full";
  /** Optional className for the panel container */
  className?: string;
  children: React.ReactNode;
}

const WIDTH_CLASSES: Record<NonNullable<DetailDrawerProps["width"]>, string> = {
  sm: "w-80 max-w-full",
  md: "w-96 max-w-full",
  lg: "w-[700px] max-w-full",
  xl: "w-[900px] max-w-full",
  full: "w-full",
};

export function DetailDrawer({
  isOpen,
  onClose,
  width = "md",
  className,
  children,
}: DetailDrawerProps) {
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40"
        onClick={onClose}
        data-testid="detail-drawer-overlay"
      />
      <div
        className={cn(
          "fixed right-0 top-0 h-full bg-white dark:bg-gray-900 shadow-xl z-50 flex flex-col overflow-hidden",
          WIDTH_CLASSES[width],
          className,
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        data-testid="detail-drawer-panel"
      >
        {children}
      </div>
    </>
  );
}

export interface DetailDrawerHeaderProps {
  /** Icon element (e.g. <Landmark className="h-6 w-6" />) */
  icon?: React.ReactNode;
  /** Main title */
  title: React.ReactNode;
  /** Subtitle below the title */
  subtitle?: React.ReactNode;
  /** Close handler - renders close button when provided */
  onClose?: () => void;
  /** Gradient background classes (e.g. "from-amber-50 to-orange-50") */
  gradient?: string;
  /** Additional content rendered below the title row (filters, controls, etc.) */
  children?: React.ReactNode;
  /** Optional className */
  className?: string;
}

export function DetailDrawerHeader({
  icon,
  title,
  subtitle,
  onClose,
  gradient,
  children,
  className,
}: DetailDrawerHeaderProps) {
  return (
    <div
      className={cn(
        "px-6 py-4 border-b flex-shrink-0",
        gradient
          ? `bg-gradient-to-r ${gradient}`
          : "border-gray-200 dark:border-gray-700",
        className,
      )}
      data-testid="detail-drawer-header"
    >
      <div className="flex justify-between items-start">
        <div className="flex items-center space-x-3">
          {icon}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {title}
            </h2>
            {subtitle && (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="detail-drawer-close">
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}

export interface DetailDrawerContentProps {
  children: React.ReactNode;
  /** Optional className */
  className?: string;
}

export function DetailDrawerContent({
  children,
  className,
}: DetailDrawerContentProps) {
  return (
    <div
      className={cn("flex-1 overflow-y-auto p-6", className)}
      data-testid="detail-drawer-content"
    >
      {children}
    </div>
  );
}

export interface DetailDrawerFooterProps {
  children: React.ReactNode;
  /** Optional className */
  className?: string;
}

export function DetailDrawerFooter({
  children,
  className,
}: DetailDrawerFooterProps) {
  return (
    <div
      className={cn(
        "flex-shrink-0 border-t border-gray-200 dark:border-gray-700 px-6 py-4",
        className,
      )}
      data-testid="detail-drawer-footer"
    >
      {children}
    </div>
  );
}
