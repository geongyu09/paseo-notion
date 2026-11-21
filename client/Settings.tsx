import { useSettings, useTranslation } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  type SettingsInputHandle,
  SettingsRow,
  SettingsSection,
  useToast,
} from "@getpaseo/plugin/client/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { connection } from "../shared/notion";
import { useWorkspaces } from "./data";
import { messages } from "./messages";

export function ConnectionSettings() {
  const settings = useSettings(connection);
  const workspaces = useWorkspaces();
  const input = useRef<SettingsInputHandle>(null);
  const toast = useToast();
  const queries = useQueryClient();
  const { t } = useTranslation(messages);

  if (settings.status === "loading") return null;
  if (settings.status !== "ready") {
    return (
      <SettingsSection title={t("notionConnection")}>
        <SettingsCard>
          <SettingsRow label={t("settingsFailed")} error={settings.error} />
        </SettingsCard>
      </SettingsSection>
    );
  }

  const tokens = settings.values.tokens;
  const write = async (next: string[], done: string) => {
    if (!(await settings.save({ ...settings.values, tokens: next }, settings.revision))) {
      toast.error(t("tokenSaveFailed"));
      return false;
    }
    await queries.invalidateQueries({ queryKey: ["notion"] });
    toast.show(done, { variant: "success" });
    return true;
  };
  const add = async () => {
    const token = input.current?.getText().trim() ?? "";
    if (!token) return;
    if (tokens.includes(token)) return toast.error(t("tokenExists"));
    if (await write([...tokens, token], t("tokenAdded"))) input.current?.replaceText("");
  };

  return (
    <SettingsSection title={t("notionConnection")}>
      <SettingsCard>
        {tokens.map((token, i) => (
          <SettingsAction
            key={token}
            // Names come back in token order; hide them while a save reorders the list.
            label={(!workspaces.isFetching && workspaces.data?.[i]?.name) || t("readingWorkspaceName")}
            hint={`${token.slice(0, 4)}…${token.slice(-4)}`}
            actionLabel={t("delete")}
            disabled={settings.saving}
            onPress={() => void write(tokens.filter((other) => other !== token), t("tokenDeleted"))}
          />
        ))}
        <SettingsInput
          ref={input}
          label={t("addTokenLabel")}
          hint={t("addTokenHint")}
          placeholder="ntn_..."
          secureTextEntry
          onChangeText={() => {}}
          error={settings.saveError ?? null}
        />
        <SettingsAction label={t("addToken")} actionLabel={t("add")} disabled={settings.saving} onPress={() => void add()} />
      </SettingsCard>
    </SettingsSection>
  );
}
