"use client";

import {
  Clock3,
  History,
  Menu,
  Moon,
  Settings,
  SlidersHorizontal,
  Sun,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useWorkspace } from "@/components/app/workspace-provider";

const navigation = [
  { href: "/", ja: "ファイル追加", en: "Add files", icon: Clock3 },
  { href: "/optimize", ja: "最適化", en: "Optimize", icon: SlidersHorizontal },
  { href: "/history", ja: "履歴", en: "History", icon: History },
  { href: "/settings", ja: "設定", en: "Settings", icon: Settings },
];

export function AppHeader() {
  const pathname = usePathname();
  const { preferences, updatePreferences } = useWorkspace();
  const [menuOpen, setMenuOpen] = useState(false);
  const dark = preferences.theme === "dark";

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[color:var(--surface)/.92] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          aria-label="Compression Files ホーム"
        >
          <span className="brand-grid grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--primary)] text-xs font-black text-white">
            CF
          </span>
          <span className="truncate text-[15px] font-black tracking-tight text-[var(--text)]">
            Compression Files
          </span>
        </Link>

        <nav
          className="hidden items-center gap-1 md:flex"
          aria-label="メインナビゲーション"
        >
          {navigation.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const label = preferences.language === "en" ? item.en : item.ja;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-10 items-center gap-2 rounded-xl px-3 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                  active
                    ? "bg-[var(--primary-soft)] text-[var(--primary-strong)]"
                    : "text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text)]"
                }`}
              >
                <item.icon size={15} aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => updatePreferences({ theme: dark ? "light" : "dark" })}
            className="grid size-11 place-items-center rounded-xl text-[var(--muted)] hover:bg-[var(--surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            aria-label={dark ? "ライトモードに切り替える" : "ダークモードに切り替える"}
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="grid size-11 place-items-center rounded-xl text-[var(--muted)] hover:bg-[var(--surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] md:hidden"
            aria-label={menuOpen ? "メニューを閉じる" : "メニューを開く"}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav
          className="border-t border-[var(--border)] bg-[var(--surface)] p-3 md:hidden"
          aria-label="モバイルナビゲーション"
        >
          <div className="mx-auto grid max-w-7xl grid-cols-4 gap-2">
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl bg-[var(--surface-subtle)] text-[10px] font-bold text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              >
                <item.icon size={17} aria-hidden="true" />{" "}
                {preferences.language === "en" ? item.en : item.ja}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
