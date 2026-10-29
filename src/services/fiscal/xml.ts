import { XMLParser } from "fast-xml-parser";

export const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === "docZip" || name === "retEvento"
});

export function findNode(source: any, key: string): any {
  if (!source || typeof source !== "object") {
    return undefined;
  }

  if (key in source) {
    return source[key];
  }

  for (const value of Object.values(source)) {
    const found = findNode(value, key);

    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}