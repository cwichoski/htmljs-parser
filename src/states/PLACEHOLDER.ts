import {
  CODE,
  Parser,
  Part,
  PlaceholderPos,
  STATE,
  StateDefinition,
} from "../internal";

export interface PlaceholderPart extends Part, PlaceholderPos {}

export const PLACEHOLDER: StateDefinition<PlaceholderPart> = {
  name: "PLACEHOLDER",

  enter(placeholder) {
    placeholder.escape = placeholder.escape !== false;
    // TODO: double check pos.
    this.enterState(STATE.EXPRESSION, {
      skipOperators: true,
      terminator: "}",
    });
  },

  exit(placeholder) {
    if (!placeholder.value) {
      this.notifyError(
        placeholder,
        "PLACEHOLDER_EXPRESSION_REQUIRED",
        "Invalid placeholder, the expression cannot be missing"
      );
    }

    this.notify("placeholder", {
      pos: placeholder.pos,
      endPos: placeholder.endPos,
      escape: placeholder.escape,
      value: {
        pos: placeholder.value.pos,
        endPos: placeholder.value.endPos
      },
    });
  },

  return(_, childPart, placeholder) {
    placeholder.value = childPart;
    this.exitState("}");
  },
};

export function checkForPlaceholder(parser: Parser, code: number) {
  if (code === CODE.DOLLAR) {
    const nextCode = parser.lookAtCharCodeAhead(1);
    if (nextCode === CODE.OPEN_CURLY_BRACE) {
      // The placeholder expression starts after first curly brace so skip
      // past the {
      parser.enterState(STATE.PLACEHOLDER, { escape: true });
      parser.skip(1);
      return true;
    } else if (
      nextCode === CODE.EXCLAMATION &&
      parser.lookAtCharCodeAhead(2) === CODE.OPEN_CURLY_BRACE
    ) {
      // The placeholder expression starts after first curly brace so skip
      // past the !{
      parser.enterState(STATE.PLACEHOLDER, { escape: false });
      parser.skip(2);
      return true;
    }
  }

  return false;
}

export function checkForEscapedPlaceholder(parser: Parser, code: number) {
  // Look for \${ and \$!{
  if (code === CODE.BACK_SLASH) {
    if (parser.lookAtCharCodeAhead(1) === CODE.DOLLAR) {
      if (parser.lookAtCharCodeAhead(2) === CODE.OPEN_CURLY_BRACE) {
        return true;
      } else if (parser.lookAtCharCodeAhead(2) === CODE.EXCLAMATION) {
        if (parser.lookAtCharCodeAhead(3) === CODE.OPEN_CURLY_BRACE) {
          return true;
        }
      }
    }
  }

  return false;
}

export function checkForEscapedEscapedPlaceholder(parser: Parser, code: number) {
  // Look for \\${ and \\$!{
  if (code === CODE.BACK_SLASH) {
    if (parser.lookAtCharCodeAhead(1) === CODE.BACK_SLASH) {
      if (parser.lookAtCharCodeAhead(2) === CODE.DOLLAR) {
        if (parser.lookAtCharCodeAhead(3) === CODE.OPEN_CURLY_BRACE) {
          return true;
        } else if (parser.lookAtCharCodeAhead(3) === CODE.EXCLAMATION) {
          if (parser.lookAtCharCodeAhead(4) === CODE.OPEN_CURLY_BRACE) {
            return true;
          }
        }
      }
    }
  }

  return false;
}
