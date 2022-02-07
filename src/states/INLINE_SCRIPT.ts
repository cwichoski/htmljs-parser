import { CODE, Part, Pos, STATE, StateDefinition } from "../internal";

export interface InlineScriptPart extends Part {
  value: Pos;
  block: boolean;
}

export const INLINE_SCRIPT: StateDefinition<InlineScriptPart> = {
  name: "INLINE_SCRIPT",

  enter(inlineScript) {
    this.endText();
    this.skip(1); // skip the whitespace after $
    inlineScript.block = false;
  },

  exit(inlineScript) {
    this.notify("scriptlet", {
      pos: inlineScript.pos,
      endPos: inlineScript.endPos,
      block: inlineScript.block,
      value: {
        pos: inlineScript.value.pos,
        endPos: inlineScript.value.endPos
      }
    });
  },

  return(_, childPart, inlineScript) {
    inlineScript.value = childPart;
    if (inlineScript.block) this.skip(1); // skip }
    this.exitState();
  },

  char(_, code, inlineScript) {
    if (code === CODE.OPEN_CURLY_BRACE) {
      inlineScript.block = true;
      this.enterState(STATE.EXPRESSION, {
        terminator: "}",
        skipOperators: true,
      });
    } else {
      this.rewind(1);
      this.enterState(STATE.EXPRESSION, { terminatedByEOL: true });
    }
  },
};
