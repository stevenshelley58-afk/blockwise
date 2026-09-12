"use client";

/*
 * Shell command menu (⌘K / Ctrl+K). Renders the desktop topbar trigger pill
 * and the palette dialog. Navigation targets and all copy come from the niche
 * config, so the menu re-skins automatically for a cloned niche.
 */

import { Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { navByVariant } from "@/components/sidebar-nav";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { niche } from "@/config/niche";

export function CommandMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const copy = niche.copy.shell.commandMenu;
  const navItems = navByVariant.self_serve;

  function run(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost-pill"
        size="pill"
        arrow={null}
        onClick={() => setOpen(true)}
        aria-label={copy.placeholder}
        className="hidden w-[190px] md:inline-flex"
      >
        <Search aria-hidden size={14} />
        {niche.copy.shell.searchButton}
        <kbd className="ml-auto rounded-[5px] border border-border bg-(--surface-subtle) px-1.5 py-px font-mono text-[10px] text-muted-foreground">
          ⌘K / Ctrl K
        </kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={niche.product.name}
        description={copy.placeholder}
      >
        <CommandInput placeholder={copy.placeholder} />
        <CommandList>
          <CommandEmpty>{copy.empty}</CommandEmpty>
          <CommandGroup heading={copy.actionsGroup}>
            <CommandItem onSelect={() => run(() => router.push("/ad-studio"))}>
              <Plus aria-hidden />
              {copy.createAd}
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading={copy.navigateGroup}>
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={item.href}
                  value={item.label}
                  onSelect={() => run(() => router.push(item.href))}
                >
                  {Icon ? <Icon aria-hidden /> : null}
                  {item.label}
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
