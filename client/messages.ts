import { defineTranslations } from "@getpaseo/plugin/client";
import en from "./locales/en.json";
import ko from "./locales/ko.json";

export const messages = defineTranslations({ resources: { en, ko } });
