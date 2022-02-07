import { CODE, StateDefinition, Part } from "../internal";

export interface StringPart extends Part {
  quoteCharCode: number;
}

export const STRING: StateDefinition<StringPart> = {
  name: "STRING",

  eol() {
    this.notifyError(
      this.pos,
      "INVALID_STRING",
      "EOL reached while parsing string expression"
    );
  },

  eof() {
    this.notifyError(
      this.pos,
      "INVALID_STRING",
      "EOF reached while parsing string expression"
    );
  },

  char(ch, code, string) {
    if (code === CODE.BACK_SLASH) {
      this.skip(1);
    } else if (code === string.quoteCharCode) {
      this.exitState(ch);
    }
  },
};
