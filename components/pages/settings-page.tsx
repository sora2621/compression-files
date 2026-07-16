"use client";

import { Check, Languages, Monitor, Moon, Sun, TimerReset } from "lucide-react";

import { useWorkspace, type ThemePreference } from "@/components/app/workspace-provider";
import { SettingHelp } from "@/components/workspace/setting-help";

const themes: Array<{
  value: ThemePreference;
  title: string;
  description: string;
  icon: typeof Sun;
}> = [
  { value: "light", title: "ライト", description: "明るい背景で表示", icon: Sun },
  { value: "dark", title: "ダーク", description: "暗い背景で表示", icon: Moon },
  {
    value: "system",
    title: "端末に合わせる",
    description: "OSの設定を使用",
    icon: Monitor,
  },
];

export function SettingsPage() {
  const { preferences, updatePreferences, showToast } = useWorkspace();
  const changed = (update: Parameters<typeof updatePreferences>[0]) => {
    updatePreferences(update);
    showToast("設定を保存しました。", "success");
  };

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[var(--page)]">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8">
          <p className="text-xs font-black text-[var(--primary)]">Settings</p>
          <h1 className="mt-2 text-3xl font-black text-[var(--text)]">設定</h1>
          <p className="mt-2 text-sm font-medium text-[var(--muted)]">
            この端末だけに保存されます。変更はすぐに反映されます。
          </p>
        </div>

        <div className="space-y-5">
          <fieldset className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <legend className="px-1 text-base font-black text-[var(--text)]">
              テーマ
            </legend>
            <p className="mt-1 text-xs font-medium text-[var(--muted)]">
              見やすい配色を選択してください。
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {themes.map((theme) => (
                <label
                  key={theme.value}
                  className={`relative flex min-h-28 cursor-pointer flex-col rounded-2xl border p-4 ${preferences.theme === theme.value ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border)]"}`}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={theme.value}
                    checked={preferences.theme === theme.value}
                    onChange={() => changed({ theme: theme.value })}
                    className="sr-only"
                  />
                  <theme.icon size={20} className="text-[var(--primary)]" />
                  <span className="mt-3 text-sm font-black text-[var(--text)]">
                    {theme.title}
                  </span>
                  <span className="mt-1 text-xs font-medium text-[var(--muted)]">
                    {theme.description}
                  </span>
                  {preferences.theme === theme.value && (
                    <Check
                      size={17}
                      className="absolute right-3 top-3 text-[var(--primary)]"
                      aria-label="選択中"
                    />
                  )}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <legend className="flex items-center gap-2 px-1 text-base font-black text-[var(--text)]">
              <Languages size={18} /> 言語
            </legend>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                {
                  value: "ja" as const,
                  title: "日本語",
                  description: "すべての機能説明を日本語で表示",
                },
                {
                  value: "en" as const,
                  title: "English",
                  description: "Navigation and basic labels in English",
                },
              ].map((language) => (
                <label
                  key={language.value}
                  className={`relative cursor-pointer rounded-2xl border p-4 ${preferences.language === language.value ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border)]"}`}
                >
                  <input
                    type="radio"
                    name="language"
                    checked={preferences.language === language.value}
                    onChange={() => changed({ language: language.value })}
                    className="sr-only"
                  />
                  <span className="text-sm font-black text-[var(--text)]">
                    {language.title}
                  </span>
                  <span className="mt-1 block text-xs font-medium text-[var(--muted)]">
                    {language.description}
                  </span>
                  {preferences.language === language.value && (
                    <Check
                      size={17}
                      className="absolute right-3 top-3 text-[var(--primary)]"
                    />
                  )}
                </label>
              ))}
            </div>
            {preferences.language === "en" && (
              <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                高度なコーデック説明とサーバーからの詳細メッセージは、一部日本語で表示されます。
              </p>
            )}
          </fieldset>

          <fieldset className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <legend className="flex items-center gap-2 px-1 text-base font-black text-[var(--text)]">
              <TimerReset size={18} /> ファイル保存期間
            </legend>
            <SettingHelp
              label="自動削除までの時間"
              short="処理後のダウンロードファイルをサーバーへ一時保存する時間です。"
            >
              短い時間ほどプライバシーを保ちやすくなります。期限を過ぎると復元できません。
            </SettingHelp>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {([10, 30, 60] as const).map((minutes) => (
                <label
                  key={minutes}
                  className={`relative cursor-pointer rounded-xl border p-3 text-center ${preferences.retentionMinutes === minutes ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border)]"}`}
                >
                  <input
                    type="radio"
                    name="retention"
                    checked={preferences.retentionMinutes === minutes}
                    onChange={() => changed({ retentionMinutes: minutes })}
                    className="sr-only"
                  />
                  <span className="block text-lg font-black text-[var(--text)]">
                    {minutes}
                  </span>
                  <span className="text-[10px] font-bold text-[var(--muted)]">分</span>
                </label>
              ))}
            </div>
            <p className="mt-3 text-[11px] font-medium leading-5 text-[var(--muted)]">
              元ファイルは選択した時間に関係なく、処理完了後すぐ削除されます。
            </p>
          </fieldset>
        </div>
      </div>
    </main>
  );
}
