import { Parser } from "./internal";

export function createParser(data: string, filename: string) {
  return new Parser(data, filename);
}
