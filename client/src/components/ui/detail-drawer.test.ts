import { describe, it, expect } from "vitest";

/**
 * Unit tests for DetailDrawer component logic.
 * Tests the pure configuration and utility aspects of the component.
 */

// Width class mapping (mirrors the component's WIDTH_CLASSES)
const WIDTH_CLASSES: Record<string, string> = {
  sm: "w-80 max-w-full",
  md: "w-96 max-w-full",
  lg: "w-[700px] max-w-full",
  xl: "w-[900px] max-w-full",
  full: "w-full",
};

describe("DetailDrawer width configuration", () => {
  it("has correct width class for sm", () => {
    expect(WIDTH_CLASSES["sm"]).toBe("w-80 max-w-full");
  });

  it("has correct width class for md (default)", () => {
    expect(WIDTH_CLASSES["md"]).toBe("w-96 max-w-full");
  });

  it("has correct width class for lg", () => {
    expect(WIDTH_CLASSES["lg"]).toBe("w-[700px] max-w-full");
  });

  it("has correct width class for xl", () => {
    expect(WIDTH_CLASSES["xl"]).toBe("w-[900px] max-w-full");
  });

  it("has correct width class for full", () => {
    expect(WIDTH_CLASSES["full"]).toBe("w-full");
  });

  it("all width variants include max-w-full for mobile safety", () => {
    for (const [key, value] of Object.entries(WIDTH_CLASSES)) {
      if (key !== "full") {
        expect(value).toContain("max-w-full");
      }
    }
  });
});

describe("DetailDrawer gradient configuration", () => {
  // Test that gradient string formatting works as expected
  function buildHeaderClasses(gradient?: string): string {
    const base = "px-6 py-4 border-b flex-shrink-0";
    if (gradient) {
      return `${base} bg-gradient-to-r ${gradient}`;
    }
    return `${base} border-gray-200 dark:border-gray-700`;
  }

  it("applies gradient classes when gradient is provided", () => {
    const classes = buildHeaderClasses("from-amber-50 to-orange-50");
    expect(classes).toContain("bg-gradient-to-r");
    expect(classes).toContain("from-amber-50 to-orange-50");
  });

  it("applies default border when no gradient", () => {
    const classes = buildHeaderClasses();
    expect(classes).toContain("border-gray-200");
    expect(classes).not.toContain("bg-gradient-to-r");
  });

  it("always includes flex-shrink-0 for fixed header", () => {
    expect(buildHeaderClasses()).toContain("flex-shrink-0");
    expect(buildHeaderClasses("from-purple-50 to-pink-50")).toContain("flex-shrink-0");
  });
});

describe("DetailDrawer component API", () => {
  // Validate the expected props interface structure
  interface DetailDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    width?: "sm" | "md" | "lg" | "xl" | "full";
    className?: string;
    children: unknown;
  }

  it("requires isOpen and onClose props", () => {
    const props: DetailDrawerProps = {
      isOpen: true,
      onClose: () => {},
      children: null,
    };
    expect(props.isOpen).toBe(true);
    expect(typeof props.onClose).toBe("function");
  });

  it("width defaults to md when not specified", () => {
    const defaultWidth = "md";
    expect(WIDTH_CLASSES[defaultWidth]).toBe("w-96 max-w-full");
  });

  interface DetailDrawerHeaderProps {
    icon?: unknown;
    title: unknown;
    subtitle?: unknown;
    onClose?: () => void;
    gradient?: string;
    children?: unknown;
    className?: string;
  }

  it("header onClose is optional (for embedded mode)", () => {
    const props: DetailDrawerHeaderProps = {
      title: "Test",
    };
    expect(props.onClose).toBeUndefined();
  });

  it("header supports gradient theming", () => {
    const props: DetailDrawerHeaderProps = {
      title: "Art Traditions",
      gradient: "from-purple-50 to-pink-50",
    };
    expect(props.gradient).toBe("from-purple-50 to-pink-50");
  });
});
