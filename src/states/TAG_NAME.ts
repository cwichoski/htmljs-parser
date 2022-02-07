import {
  CODE,
  STATE,
  isWhitespaceCode,
  StateDefinition,
  TemplatePart,
} from "../internal";

// TODO: This should not create nested states for the shorthands.
// the open tag state should go into the shorthands.
// This would allow removing the `nameEndPos` stuff.

export interface TagNamePart extends TemplatePart {
  curPos: number;
  nameEndPos: number;
  hadShorthandId: boolean | undefined;
  shorthandCharCode: number;
}

// We enter STATE.TAG_NAME after we encounter a "<"
// followed by a non-special character
export const TAG_NAME: StateDefinition<TagNamePart> = {
  name: "TAG_NAME",

  enter(tagName) {
    tagName.curPos = tagName.pos;
    tagName.expressions = [];
    tagName.quasis = [];
  },

  exit(tagName) {
    tagName.quasis.push({
      pos: tagName.curPos,
      endPos: this.pos,
    });

    const data = {
      pos: tagName.pos,
      endPos: tagName.endPos,
      quasis: tagName.quasis,
      expressions: tagName.expressions
    };

    switch (tagName.shorthandCharCode) {
      case CODE.NUMBER_SIGN:
        this.notify("tagShorthandId", data);
        break;
      case CODE.PERIOD:
        this.notify("tagShorthandClass", data);
        break;
      default:
        if (tagName.nameEndPos !== undefined) {
          data.endPos = data.quasis[data.quasis.length - 1].endPos = tagName.nameEndPos;
        }
        this.notify("tagName", data);
        break;
    }
  },

  return(childState, childPart, tagName) {
    switch (childState) {
      case STATE.EXPRESSION: {
        if (childPart.pos === childPart.endPos) {
          this.notifyError(
            childPart,
            "PLACEHOLDER_EXPRESSION_REQUIRED",
            "Invalid placeholder, the expression cannot be missing"
          );
        }

        tagName.expressions.push({
          pos: childPart.pos - 2, // include ${
          endPos: tagName.curPos = childPart.endPos + 1, // include }
          value: {
            pos: childPart.pos,
            endPos: childPart.endPos,
          },
        });

        break;
      }
      case STATE.TAG_NAME: {
        if ((childPart as TagNamePart).shorthandCharCode === CODE.NUMBER_SIGN) {
          if (tagName.hadShorthandId) {
            return this.notifyError(
              childPart,
              "INVALID_TAG_SHORTHAND",
              "Multiple shorthand ID parts are not allowed on the same tag"
            );
          }

          tagName.hadShorthandId = true;
        }
        break;
      }
    }
  },

  eol() {
    if (this.isConcise && !this.withinAttrGroup) {
      this.rewind(1);
      this.exitState();
    }
  },

  eof() {
    this.exitState();
  },

  char(_, code, tagName) {
    if (
      code === CODE.DOLLAR &&
      this.lookAtCharCodeAhead(1) === CODE.OPEN_CURLY_BRACE
    ) {
      tagName.quasis.push({
        pos: tagName.curPos,
        endPos: this.pos,
      });
      this.skip(1); // skip {
      this.enterState(STATE.EXPRESSION, {
        skipOperators: true,
        terminator: "}",
      });
    } else if (code === CODE.BACK_SLASH) {
      // Handle string escape sequence
      this.skip(1);
    } else if (
      isWhitespaceCode(code) ||
      code === CODE.EQUAL ||
      (code === CODE.COLON && this.lookAtCharCodeAhead(1) === CODE.EQUAL) ||
      code === CODE.OPEN_PAREN ||
      code === CODE.FORWARD_SLASH ||
      code === CODE.PIPE ||
      (this.isConcise
        ? code === CODE.SEMICOLON
        : code === CODE.CLOSE_ANGLE_BRACKET)
    ) {
      this.rewind(1);
      this.exitState();
    } else if (code === CODE.PERIOD || code === CODE.NUMBER_SIGN) {
      if (tagName.shorthandCharCode) {
        this.rewind(1);
        this.exitState();
      } else {
        if (tagName.nameEndPos === undefined) {
          tagName.nameEndPos = this.pos;
        }

        this.enterState(STATE.TAG_NAME, { shorthandCharCode: code });
      }
    }
  },
};
