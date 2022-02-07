import { checkForCDATA, checkForClosingTag, checkForEscapedEscapedPlaceholder, checkForEscapedPlaceholder, checkForPlaceholder } from ".";
import { Parser, STATE, CODE, StateDefinition } from "../internal";

// We enter STATE.PARSED_TEXT_CONTENT when we are parsing
// the body of a tag does not contain HTML tags but may contains
// placeholders
export const PARSED_TEXT_CONTENT: StateDefinition = {
  name: "PARSED_TEXT_CONTENT",

  enter() {
    this.textParseMode = "parsed-text";
    this.startText();
  },

  eol(newLine) {
    if (this.isWithinSingleLineHtmlBlock) {
      // We are parsing "HTML" and we reached the end of the line. If we are within a single
      // line HTML block then we should return back to the state to parse concise HTML.
      // A single line HTML block can be at the end of the tag or on its own line:
      //
      // span class="hello" - This is an HTML block at the end of a tag
      //     - This is an HTML block on its own line
      //
      this.endHtmlBlock();
    } else if (this.htmlBlockDelimiter) {
      this.handleDelimitedBlockEOL(newLine);
    }
  },

  eof: Parser.prototype.htmlEOF,

  char(ch, code) {
    if (!this.isConcise && code === CODE.OPEN_ANGLE_BRACKET) {
      // First, see if we need to see if we reached the closing tag
      // and then check if we encountered CDATA
      if (checkForClosingTag(this) || checkForCDATA(this)) return;
    }

    if (code === CODE.FORWARD_SLASH) {
      if (this.lookAtCharCodeAhead(1) === CODE.ASTERISK) {
        // Skip over code inside a JavaScript block comment
        this.enterState(STATE.JS_COMMENT_BLOCK);
        return;
      } else if (this.lookAtCharCodeAhead(1) === CODE.FORWARD_SLASH) {
        this.enterState(STATE.JS_COMMENT_LINE);
        return;
      }
    }

    if (code === CODE.BACKTICK) {
      this.enterState(STATE.TEMPLATE_STRING);
      return;
    }

    if (checkForEscapedEscapedPlaceholder(this, code)) {
      this.skip(1);
    } else if (checkForEscapedPlaceholder(this, code)) {
      this.skip(1);
      return;
    } else if (checkForPlaceholder(this, code)) {
      // We went into placeholder state...
      this.endText();
      return;
    }
  },
};
