/** Text and image carried by a paste event. Image wins, matching the scan dialog. */
export function clipboardPlainText(data: DataTransfer | null): string {
  if (!data) {
    return "";
  }
  return data.getData("text/plain") || data.getData("text") || "";
}

export function clipboardImageFile(data: DataTransfer | null): File | null {
  if (!data) {
    return null;
  }
  const items = data.items;
  if (items) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (!item || item.kind !== "file" || !item.type.toLowerCase().startsWith("image/")) {
        continue;
      }
      const file = item.getAsFile();
      if (file) {
        return file;
      }
    }
  }
  const files = data.files;
  if (!files) {
    return null;
  }
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    if (file && file.type.toLowerCase().startsWith("image/")) {
      return file;
    }
  }
  return null;
}

export function clipboardHasOtherPayload(data: DataTransfer | null): boolean {
  if (!data) {
    return false;
  }
  return Array.from(data.types).some((type) => {
    const name = type.toLowerCase();
    return name !== "" && name !== "text/plain" && name !== "text" && !name.startsWith("image/");
  });
}
