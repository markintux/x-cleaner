export const messageKeys = [
  "cli.description",
  "cli.dataDirectoryOption",
  "cli.statusDescription",
  "status.dataDirectory",
  "status.localOnlyNotice"
] as const;

export type MessageKey = (typeof messageKeys)[number];
export type MessageParameters = Readonly<Record<string, string | number>>;
export type MessageCatalog = Readonly<Record<MessageKey, string>>;
