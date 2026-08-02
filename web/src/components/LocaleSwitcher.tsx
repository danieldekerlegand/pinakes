// Locale picker for the app header (US-012). Discoverable control that switches
// the whole UI language + layout direction. Each option shows its endonym so a
// speaker recognizes their language regardless of the current UI locale.

import { Languages, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { LOCALES, type LocaleCode } from "@/lib/i18n";
import { useI18n } from "@/contexts/I18nContext";

interface LocaleSwitcherProps {
  /** Optional extra classes for the trigger button (matches header styling). */
  className?: string;
}

export function LocaleSwitcher({ className }: LocaleSwitcherProps) {
  const { locale, setLocale, t } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={
          className ??
          "p-1.5 rounded-md hover:bg-blue-500 transition-colors text-white flex items-center gap-1"
        }
        aria-label={t("settings.chooseLanguage")}
        title={t("settings.language")}
        data-testid="locale-switcher"
      >
        <Languages className="h-4 w-4" aria-hidden="true" />
        <span className="text-xs uppercase">{locale}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("settings.chooseLanguage")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(v) => setLocale(v as LocaleCode)}
        >
          {LOCALES.map((l) => (
            <DropdownMenuRadioItem
              key={l.code}
              value={l.code}
              dir={l.dir}
              className="gap-2"
            >
              <span className="flex-1">{l.endonym}</span>
              <span className="text-xs text-muted-foreground">{l.englishName}</span>
              {l.code === locale && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
